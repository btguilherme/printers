/**
 * MultiBrandLabelPrinter - Universal Client-Side Thermal Label Printing Library
 * Supports Zebra, Elgin, Argox, GoDEX, HPRT and other thermal printers
 * Interfaces: Local OS Spooler Bridge, Web Serial, WebUSB, Web Bluetooth, Network Direct (TCP/HTTP)
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

  function toUint8Array(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (typeof data === 'string') {
      return new TextEncoder().encode(data);
    }
    throw new Error('Unsupported data format for printing');
  }

  // --- Transport Implementations ---

  class LocalAgentTransport {
    constructor(options = {}) {
      this.baseUrl = options.baseUrl || 'http://127.0.0.1:8182';
      this.printerName = options.printerName || null;
    }

    static async discoverPrinters(agentUrl = 'http://127.0.0.1:8182') {
      const cleanUrl = agentUrl.replace(/\/$/, '');
      try {
        const response = await fetch(`${cleanUrl}/printers`, {
          method: 'GET',
          headers: { 'Accept': 'application/json' }
        });
        if (!response.ok) {
          throw new Error(`Servidor respondeu com status ${response.status}`);
        }
        const data = await response.json();
        return data.printers || [];
      } catch (err) {
        throw new Error(`Não foi possível conectar ao Agente Local de Impressão (127.0.0.1:8182). Verifique se o agente está em execução: ${err.message}`);
      }
    }

    async send(data) {
      const payloadString = typeof data === 'string' ? data : new TextDecoder().decode(toUint8Array(data));
      const response = await fetch(`${this.baseUrl}/print`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          printer: this.printerName,
          data: payloadString
        })
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.message || `Erro no Agente de Impressão (${response.status})`);
      }

      const result = await response.json();
      if (result.status === 'error') {
        throw new Error(result.message);
      }
      return result;
    }

    get name() {
      return `OS Spooler (${this.printerName || 'Impressora Padrão do SO'})`;
    }
  }

  class WebSerialTransport {
    constructor(port, options = {}) {
      this.port = port;
      this.baudRate = options.baudRate || 9600;
    }

    static isSupported() {
      return typeof navigator !== 'undefined' && 'serial' in navigator;
    }

    static async requestDevice(filters = []) {
      if (!WebSerialTransport.isSupported()) {
        throw new Error('Web Serial API não suportada neste navegador.');
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
      if (this.port) {
        await this.port.close().catch(() => {});
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
      return `Serial/USB Direct (Vendor ID: ${info.usbVendorId || 'N/A'})`;
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
        throw new Error('WebUSB API não é suportada neste navegador.');
      }
      const filters = vendorId ? [{ vendorId }] : [];
      const device = await navigator.usb.requestDevice({ filters });
      return new WebUSBTransport(device);
    }

    async connect() {
      await this.device.open();
      if (this.device.configuration === null) {
        await this.device.selectConfiguration(1);
      }

      let targetInterface = this.device.configuration.interfaces.find(iface =>
        iface.alternates.some(alt => alt.interfaceClass === 7)
      ) || this.device.configuration.interfaces[0];

      if (targetInterface) {
        this.interfaceNumber = targetInterface.interfaceNumber;
        await this.device.claimInterface(this.interfaceNumber);

        const alt = targetInterface.alternates[0];
        const endpoint = alt.endpoints.find(e => e.direction === 'out');
        this.endpointOut = endpoint ? endpoint.endpointNumber : 1;
      }
    }

    async send(data) {
      if (!this.device.opened) {
        await this.connect();
      }
      const bytes = toUint8Array(data);
      await this.device.transferOut(this.endpointOut || 1, bytes);
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
        throw new Error('Web Bluetooth não é suportado neste navegador.');
      }
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [
          '00001101-0000-1000-8000-00805f9b34fb',
          '49535343-fe7d-4ae5-8fa9-9fafd205e455',
          'e7810a71-73ae-499d-8c15-faa9aef0c3f2'
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
      throw new Error('Nenhuma característica gravável de Bluetooth encontrada.');
    }

    async send(data) {
      if (!this.characteristic) {
        await this.connect();
      }
      const bytes = toUint8Array(data);
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
      this.endpoint = options.endpoint || `http://${this.host}:${this.port}/print`;
    }

    async send(data) {
      const bytes = toUint8Array(data);
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: bytes
      });
      if (!response.ok) {
        throw new Error(`Erro na conexão de rede HTTP: ${response.status}`);
      }
    }

    get name() {
      return `Rede IP (${this.host}:${this.port})`;
    }
  }

  // --- Command Template Generators for Brands ---

  const CommandGenerators = {
    zebra: {
      name: 'Zebra (ZPL II)',
      language: 'ZPL',
      generateLabel: ({ title, barcode, qrCode, details = [] }) => {
        let zpl = `^XA\n`;
        zpl += `^PW800\n`;
        zpl += `^LL400\n`;
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

    argox: {
      name: 'Argox (PPLB)',
      language: 'PPLB',
      generateLabel: ({ title, barcode, qrCode, details = [] }) => {
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
        LocalAgent: LocalAgentTransport,
        WebSerial: WebSerialTransport,
        WebUSB: WebUSBTransport,
        WebBluetooth: WebBluetoothTransport,
        Network: NetworkPrinterTransport
      };
    }

    static get generators() {
      return CommandGenerators;
    }

    async connect() {
      if (this.transport && typeof this.transport.connect === 'function') {
        await this.transport.connect();
      }
    }

    async print(data) {
      if (!this.transport) {
        throw new Error('Nenhum método de transporte configurado para LabelPrinter');
      }
      return await this.transport.send(data);
    }
  }

  return LabelPrinter;
}));
