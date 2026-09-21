# Universal Client-Side Thermal Label Printer Library & Demo

Solução multiplataforma e 100% no lado do cliente (browser) em JavaScript para listagem, geração de linguagem de comando e impressão em impressoras térmicas de etiquetas das marcas **Zebra, Elgin, Argox, GoDEX, HPRT** e similares.

---

## 🚀 Funcionalidades

- **Suporte Multi-Marca & Multi-Linguagem:**
  - **Zebra**: ZPL II (`^XA...^XZ`)
  - **Elgin**: TSPL / ZPL (`SIZE`, `GAP`, `BARCODE`, `TEXT`)
  - **Argox**: PPLB / PPLA (`N`, `q`, `Q`, `A`, `B`, `P1`)
  - **GoDEX**: EZPL (`^Q`, `^W`, `AH`, `BA`, `BQ`, `E`)
  - **HPRT**: TSPL (`SIZE`, `GAP`, `SPEED`, `DENSITY`, `BARCODE`)

- **Suporte Multi-Transporte (Comunicação Sem Drivers Obrigatórios):**
  - **Web Serial API**: Conexão direta com portas COM / USB Serial no navegador (Chrome, Edge, Opera).
  - **WebUSB API**: Comunicação USB direta com a impressora (Classe 7 / Printer).
  - **Web Bluetooth API**: Impressão sem fio em impressoras móveis ou de bancada com Bluetooth.
  - **Rede Direct (TCP / HTTP REST / WebSocket)**: Envio direto via IP da impressora na rede local (porta `9100`).
  - **Agente Spooler Local (WebSocket Bridge)**: Comunicação com spooler do sistema operacional (Windows, Linux, macOS) para impressoras instaladas no driver do SO.

- **Interface Demo Interativa (`index.html`)**:
  - Seleção e detecção de impressoras disponíveis.
  - Seleção de marca da impressora com visualização e edição do código fonte de comandos em tempo real.
  - Terminal de logs de operações e tratamento de erros.

---

## 📂 Estrutura do Projeto

```
.
├── css/
│   └── style.css            # Estilos da interface web de exemplo
├── js/
│   └── label-printer.js     # Biblioteca principal client-side
├── test/
│   └── label-printer.test.js # Testes unitários em Node.js
├── index.html               # Aplicação web e exemplo de uso
└── README.md                # Documentação do projeto
```

---

## 🛠️ Como Utilizar no seu Projeto JavaScript

### 1. Incluir a biblioteca no HTML
```html
<script src="js/label-printer.js"></script>
```

### 2. Gerar comandos para a marca desejada
```javascript
// Exemplo: Gerando ZPL para Zebra
const zpl = LabelPrinter.generators.zebra.generateLabel({
  title: 'PRODUTO MODELO A',
  barcode: '7891234567890',
  qrCode: 'https://exemplo.com.br/l/123',
  details: ['LOTE: 2023-A', 'VAL: 12/2026']
});

// Exemplo: Gerando TSPL para Elgin ou HPRT
const tspl = LabelPrinter.generators.elgin.generateLabel({
  title: 'ETIQUETA ELGIN',
  barcode: '7891234567890'
});
```

### 3. Conectar e Imprimir via Web Serial
```javascript
// Solicita permissão do usuário para porta serial/USB
const serialTransport = await LabelPrinter.transports.WebSerial.requestDevice();

// Cria instância da impressora
const printer = new LabelPrinter(serialTransport);

// Conecta e envia o código da etiqueta
await printer.print(zpl);
```

### 4. Conectar e Imprimir via Rede IP
```javascript
const netTransport = new LabelPrinter.transports.Network('192.168.1.200', { port: 9100 });
const printer = new LabelPrinter(netTransport);
await printer.print(zpl);
```

---

## 🧪 Executando os Testes

Para rodar os testes unitários da biblioteca:

```bash
node test/label-printer.test.js
```

---

## 🌐 Compatibilidade de Navegadores

| Transporte | Chrome / Edge / Opera | Firefox | Safari |
|---|---|---|---|
| Web Serial | ✅ Sim | ❌ Não | ❌ Não |
| WebUSB | ✅ Sim | ❌ Não | ❌ Não |
| Web Bluetooth | ✅ Sim | ⚠️ Com flag | ✅ iOS / macOS (Parcial) |
| Rede (HTTP/WS) | ✅ Sim | ✅ Sim | ✅ Sim |
| Agente Local | ✅ Sim | ✅ Sim | ✅ Sim |
