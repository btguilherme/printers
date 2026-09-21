/**
 * MultiBrandLabelPrinter - Universal Client-Side Thermal Label Printing Library
 * Supports Zebra, Elgin, Argox, GoDEX, HPRT and other thermal printers
 * Interfaces: Web Serial, WebUSB, Web Bluetooth, Network Direct (TCP/HTTP/WebSocket), and Local Agent Bridge
 */

(function (global, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    global.LabelPrinter = factory();
  }
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  // Utility to convert String / Uint8Array to ArrayBuffer / Uint8Array
  function toUint8Array(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (typeof data === 'string') {
      return new TextEncoder().encode(data);
    }
    throw new Error('Unsupported data format for printing');
  }

  // --- Transport Implementations ---

  class WebSerialTransport {
    constructor(port, options = {}) {
      this.port = port;
      this.baudRate = options.baudRate || 9600;
      this.writer = null;
      this.reader = null;
    }

    static isSupported() {
      return typeof navigator !== 'undefined' && 'serial' in navigator;
    }

    static async requestDevice(filters = []) {
      if (!WebSerialTransport.isSupported()) {
        throw new Error('Web Serial API is not supported in this browser.');
      }
      const port = await navigator.serial.requestPort({ filters });
      return new WebSerialTransport(port);
    }

    static async getGrantedDevices() {
      if (!WebSerialTransport.isSupported()) return [];
      const ports = await navigator.serial.getPorts();
      return ports.map(port => new WebSerialTransport(port));
    }

    async connect() {
      if (!this.port.readable || !this.port.writable) {
        await this.port.open({ baudRate: this.baudRate });
      }
    }

    async disconnect() {
      if (this.writer) {
        await this.writer.close();
        this.writer = null;
      }
      if (this.reader) {
        await this.reader.cancel();
        this.reader = null;
      }
      if (this.port) {
        await this.port.close();
      }
    }

    async send(data) {
      await this.connect();
      const bytes = toUint8Array(data);
      const writer = this.port.writable.getWriter();
      try {
        await writer.write(bytes);
      } finally {
        writer.releaseLock();
      }
    }

    get name() {
      const info = this.port.getInfo ? this.port.getInfo() : {};
      return `Serial Printer (USB Vendor ID: ${info.usbVendorId || 'N/A'}, Product ID: ${info.usbProductId || 'N/A'})`;
    }
  }

  class WebUSBTransport {
    constructor(device) {
      this.device = device;
      this.interfaceNumber = 0;
      this.endpointOut = null;
    }

    static isSupported() {
      return typeof navigator !== 'undefined' && 'usb' in navigator;
    }

    static async requestDevice(vendorId) {
      if (!WebUSBTransport.isSupported()) {
        throw new Error('WebUSB API is not supported in this browser.');
      }
      const filters = vendorId ? [{ vendorId }] : [];
      const device = await navigator.usb.requestDevice({ filters });
      return new WebUSBTransport(device);
    }

    static async getGrantedDevices() {
      if (!WebUSBTransport.isSupported()) return [];
      const devices = await navigator.usb.getDevices();
      return devices.map(dev => new WebUSBTransport(dev));
    }

    async connect() {
      await this.device.open();
      if (this.device.configuration === null) {
        await this.device.selectConfiguration(1);
      }

      // Find printer interface (class 7) or fallback to first interface
      let targetInterface = this.device.configuration.interfaces.find(iface =>
        iface.alternates.some(alt => alt.interfaceClass === 7)
      ) || this.device.configuration.interfaces[0];

      if (targetInterface) {
        this.interfaceNumber = targetInterface.interfaceNumber;
        await this.device.claimInterface(this.interfaceNumber);

        const alt = targetInterface.alternates[0];
        const endpoint = alt.endpoints.find(e => e.direction === 'out');
        if (endpoint) {
          this.endpointOut = endpoint.endpointNumber;
        } else {
          this.endpointOut = 1; // Fallback
        }
      }
    }

    async disconnect() {
      if (this.device.opened) {
        try {
          await this.device.releaseInterface(this.interfaceNumber);
          await this.device.close();
        } catch (e) {
          console.warn('Error closing WebUSB device:', e);
        }
      }
    }

    async send(data) {
      if (!this.device.opened) {
        await this.connect();
      }
      const bytes = toUint8Array(data);
      if (!this.endpointOut) {
        throw new Error('No OUT endpoint found for WebUSB device');
      }
      await this.device.transferOut(this.endpointOut, bytes);
    }

    get name() {
      return this.device.productName || `USB Thermal Printer (${this.device.vendorId}:${this.device.productId})`;
    }
  }

  class WebBluetoothTransport {
    constructor(device) {
      this.device = device;
      this.characteristic = null;
    }

    static isSupported() {
      return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
    }

    static async requestDevice() {
      if (!WebBluetoothTransport.isSupported()) {
        throw new Error('Web Bluetooth is not supported in this browser.');
      }
      // Common thermal printer Bluetooth SPP / custom GATT services
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [
          '00001101-0000-1000-8000-00805f9b34fb', // Serial Port Profile (SPP)
          '49535343-fe7d-4ae5-8fa9-9fafd205e455', // Microchip / ISSC BLE
          'e7810a71-73ae-499d-8c15-faa9aef0c3f2'  // Generic printer service
        ]
      });
      return new WebBluetoothTransport(device);
    }

    async connect() {
      const server = await this.device.gatt.connect();
      const services = await server.getPrimaryServices();
      for (const service of services) {
        const characteristics = await service.getCharacteristics();
        for (const char of characteristics) {
          if (char.properties.write || char.properties.writeWithoutResponse) {
            this.characteristic = char;
            return;
          }
        }
      }
      throw new Error('No writable Bluetooth characteristic found on printer.');
    }

    async disconnect() {
      if (this.device && this.device.gatt.connected) {
        this.device.gatt.disconnect();
      }
    }

    async send(data) {
      if (!this.characteristic) {
        await this.connect();
      }
      const bytes = toUint8Array(data);
      // Bluetooth MTU chunking (default chunk 20-512 bytes)
      const chunkSize = 100;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        if (this.characteristic.properties.writeWithoutResponse) {
          await this.characteristic.writeValueWithoutResponse(chunk);
        } else {
          await this.characteristic.writeValueWithResponse(chunk);
        }
      }
    }

    get name() {
      return this.device.name || `Bluetooth Printer (${this.device.id})`;
    }
  }

  class NetworkPrinterTransport {
    constructor(host, options = {}) {
      this.host = host;
      this.port = options.port || 9100;
      this.protocol = options.protocol || 'http'; // http, ws, or raw relay endpoint
      this.endpoint = options.endpoint || `http://${this.host}:${this.port}/print`;
    }

    async send(data) {
      const bytes = toUint8Array(data);
      if (this.protocol === 'ws') {
        return new Promise((resolve, reject) => {
          const wsUrl = this.endpoint.startsWith('ws') ? this.endpoint : `ws://${this.host}:${this.port}`;
          const ws = new WebSocket(wsUrl);
          ws.binaryType = 'arraybuffer';
          ws.onopen = () => {
            ws.send(bytes);
            setTimeout(() => {
              ws.close();
              resolve();
            }, 300);
          };
          ws.onerror = (err) => reject(new Error('WebSocket network print failed: ' + err));
        });
      } else {
        // HTTP Raw POST (Direct REST/Printer IP Print Service)
        const response = await fetch(this.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: bytes,
          mode: 'cors'
        });
        if (!response.ok) {
          throw new Error(`Network HTTP print error: ${response.status} ${response.statusText}`);
        }
      }
    }

    get name() {
      return `Network Printer (${this.host}:${this.port})`;
    }
  }

  class LocalAgentTransport {
    constructor(options = {}) {
      this.url = options.url || 'ws://127.0.0.1:8182/'; // Standard local agent WebSocket URL
      this.printerName = options.printerName || null;
      this.ws = null;
    }

    static async discoverPrinters(agentUrl = 'ws://127.0.0.1:8182/') {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(agentUrl);
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error('Local print agent connection timeout'));
        }, 3000);

        ws.onopen = () => {
          ws.send(JSON.stringify({ action: 'list_printers' }));
        };

        ws.onmessage = (evt) => {
          clearTimeout(timeout);
          ws.close();
          try {
            const data = JSON.parse(evt.data);
            resolve(data.printers || []);
          } catch (e) {
            resolve([]);
          }
        };

        ws.onerror = (err) => {
          clearTimeout(timeout);
          reject(err);
        };
      });
    }

    async send(data) {
      const payload = typeof data === 'string' ? data : new TextDecoder().decode(toUint8Array(data));
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(this.url);
        ws.onopen = () => {
          ws.send(JSON.stringify({
            action: 'print',
            printer: this.printerName,
            data: payload
          }));
        };
        ws.onmessage = (evt) => {
          ws.close();
          resolve();
        };
        ws.onerror = (err) => {
          reject(new Error('Local Agent print error: ' + err.message));
        };
      });
    }

    get name() {
      return `Local Spooler Agent (${this.printerName || 'Default OS Printer'})`;
    }
  }

  // --- Command Template Generators for Brands ---

  const CommandGenerators = {
    // Zebra (ZPL II / EPL2)
    zebra: {
      name: 'Zebra (ZPL II)',
      language: 'ZPL',
      generateLabel: ({ title, barcode, qrCode, details = [] }) => {
        let zpl = `^XA\n`;
        zpl += `^PW800\n`; // Print width 80mm (~800 dots @ 203dpi)
        zpl += `^LL400\n`; // Label length 40mm (~400 dots @ 203dpi)
        zpl += `^FO50,30^A0N,40,40^FD${title || 'ZEBRA LABEL TITLE'}^FS\n`;

        let y = 80;
        if (barcode) {
          zpl += `^FO50,${y}^BY2,3,80^BCN,80,Y,N,N^FD${barcode}^FS\n`;
          y += 120;
        }

        if (qrCode) {
          zpl += `^FO500,30^BQN,2,5^FDQA,${qrCode}^FS\n`;
        }

        details.forEach(line => {
          zpl += `^FO50,${y}^A0N,28,28^FD${line}^FS\n`;
          y += 35;
        });

        zpl += `^PQ1\n`;
        zpl += `^XZ\n`;
        return zpl;
      }
    },

    // Elgin (TSPL / ZPL compatible models like L42, L42 Pro, L42 DT)
    elgin: {
      name: 'Elgin (TSPL / ZPL)',
      language: 'TSPL',
      generateLabel: ({ title, barcode, qrCode, details = [] }) => {
        let tspl = `SIZE 100 mm, 50 mm\n`;
        tspl += `GAP 3 mm, 0 mm\n`;
        tspl += `DIRECTION 1\n`;
        tspl += `CLS\n`;
        tspl += `TEXT 50,30,"3",0,1,1,"${title || 'ELGIN LABEL TITLE'}"\n`;

        let y = 80;
        if (barcode) {
          tspl += `BARCODE 50,${y},"128",80,1,0,2,2,"${barcode}"\n`;
          y += 110;
        }

        if (qrCode) {
          tspl += `QRCODE 500,30,L,5,A,0,"${qrCode}"\n`;
        }

        details.forEach(line => {
          tspl += `TEXT 50,${y},"2",0,1,1,"${line}"\n`;
          y += 30;
        });

        tspl += `PRINT 1,1\n`;
        return tspl;
      }
    },

    // Argox (PPLA / PPLB / PPLZ - e.g. OS-214plus, IX4)
    argox: {
      name: 'Argox (PPLB)',
      language: 'PPLB',
      generateLabel: ({ title, barcode, qrCode, details = [] }) => {
        // PPLB (Eltron / Argox System II format)
        let pplb = `\nN\n`;
        pplb += `q800\n`;
        pplb += `Q400,24\n`;
        pplb += `A50,30,0,4,1,1,N,"${title || 'ARGOX LABEL TITLE'}"\n`;

        let y = 80;
        if (barcode) {
          pplb += `B50,${y},0,1,2,5,80,B,"${barcode}"\n`;
          y += 120;
        }

        if (qrCode) {
          pplb += `b500,30,Q,m2,s5,"${qrCode}"\n`;
        }

        details.forEach(line => {
          pplb += `A50,${y},0,2,1,1,N,"${line}"\n`;
          y += 30;
        });

        pplb += `P1\n`;
        return pplb;
      }
    },

    // GoDEX (EZPL / TSPL - G500, RT700)
    godex: {
      name: 'GoDEX (EZPL)',
      language: 'EZPL',
      generateLabel: ({ title, barcode, qrCode, details = [] }) => {
        let ezpl = `^Q50,3\n`;
        ezpl += `^W100\n`;
        ezpl += `^H10\n`;
        ezpl += `^P1\n`;
        ezpl += `^S4\n`;
        ezpl += `^AD\n`;
        ezpl += `^C1\n`;
        ezpl += `^L\n`;
        ezpl += `AH,50,30,1,1,0,0,${title || 'GODEX LABEL TITLE'}\n`;

        let y = 80;
        if (barcode) {
          ezpl += `BA,50,${y},2,5,80,0,1,${barcode}\n`;
          y += 120;
        }

        if (qrCode) {
          ezpl += `BQ,500,30,2,5,0,1,${qrCode}\n`;
        }

        details.forEach(line => {
          ezpl += `AC,50,${y},1,1,0,0,${line}\n`;
          y += 35;
        });

        ezpl += `E\n`;
        return ezpl;
      }
    },

    // HPRT (TSPL / ZPL - HT300, N41, LPQ80)
    hprt: {
      name: 'HPRT (TSPL)',
      language: 'TSPL',
      generateLabel: ({ title, barcode, qrCode, details = [] }) => {
        let tspl = `SIZE 100 mm, 50 mm\n`;
        tspl += `GAP 3 mm, 0 mm\n`;
        tspl += `SPEED 4\n`;
        tspl += `DENSITY 8\n`;
        tspl += `CLS\n`;
        tspl += `TEXT 50,30,"TSS24.BF2",0,1,1,"${title || 'HPRT LABEL TITLE'}"\n`;

        let y = 80;
        if (barcode) {
          tspl += `BARCODE 50,${y},"128",80,1,0,2,2,"${barcode}"\n`;
          y += 110;
        }

        if (qrCode) {
          tspl += `QRCODE 500,30,L,5,A,0,"${qrCode}"\n`;
        }

        details.forEach(line => {
          tspl += `TEXT 50,${y},"TSS24.BF2",0,1,1,"${line}"\n`;
          y += 30;
        });

        tspl += `PRINT 1,1\n`;
        return tspl;
      }
    }
  };

  // --- Main LabelPrinter Class ---

  class LabelPrinter {
    constructor(transport) {
      this.transport = transport;
    }

    static get transports() {
      return {
        WebSerial: WebSerialTransport,
        WebUSB: WebUSBTransport,
        WebBluetooth: WebBluetoothTransport,
        Network: NetworkPrinterTransport,
        LocalAgent: LocalAgentTransport
      };
    }

    static get generators() {
      return CommandGenerators;
    }

    // High level method to list accessible devices
    static async discoverDevices() {
      const devices = [];

      if (WebSerialTransport.isSupported()) {
        try {
          const serials = await WebSerialTransport.getGrantedDevices();
          serials.forEach(s => devices.push({ type: 'Serial', name: s.name, transport: s }));
        } catch (e) {
          console.warn('Error fetching Serial devices', e);
        }
      }

      if (WebUSBTransport.isSupported()) {
        try {
          const usbs = await WebUSBTransport.getGrantedDevices();
          usbs.forEach(u => devices.push({ type: 'USB', name: u.name, transport: u }));
        } catch (e) {
          console.warn('Error fetching USB devices', e);
        }
      }

      return devices;
    }

    async connect() {
      if (this.transport && typeof this.transport.connect === 'function') {
        await this.transport.connect();
      }
    }

    async disconnect() {
      if (this.transport && typeof this.transport.disconnect === 'function') {
        await this.transport.disconnect();
      }
    }

    async print(data) {
      if (!this.transport) {
        throw new Error('No transport defined for LabelPrinter');
      }
      await this.transport.send(data);
    }
  }

  return LabelPrinter;
}));
