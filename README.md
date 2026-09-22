# Universal Client-Side Thermal Label Printer Library & Demo

Solução multiplataforma e 100% no lado do cliente (browser) em JavaScript para listagem, geração de linguagem de comando e impressão em impressoras térmicas de etiquetas das marcas **Zebra, Elgin, Argox, GoDEX, HPRT** e similares.

---

## 🚀 Como Funciona a Listagem de Impressoras do Sistema Operacional

Navegadores web (Chrome, Firefox, Safari) por questões de segurança de sandbox **não possuem permissão nativa direta** para listar as impressoras instaladas no sistema operacional (Windows, Linux, macOS) nem impressoras de rede compartilhadas via spooler do SO sem ação direta do usuário.

Para exibir a **lista de impressoras instaladas no menu dropdown** automaticamente:

### 1. Iniciar o Agente Spooler Local (Incluído no Projeto)

Você pode executar o agente leve de impressão em **Node.js** ou **Python**:

#### Via Node.js:
```bash
node agent/server.js
```

#### Via Python:
```bash
python agent/server.py
```

O agente rodará em `http://127.0.0.1:8182` e irá:
- Consultar o sistema operacional e listar todas as impressoras (locais e de rede compartilhadas).
- Enviar comandos RAW (ZPL, TSPL, PPLB, EZPL) diretamente para a fila do spooler de impressão do SO da impressora escolhida no menu.

---

## 💻 Funcionalidades & Interfaces Suportadas

- **Suporte Multi-Marca & Multi-Linguagem:**
  - **Zebra**: ZPL II (`^XA...^XZ`)
  - **Elgin**: TSPL / ZPL (`SIZE`, `GAP`, `BARCODE`, `TEXT`)
  - **Argox**: PPLB / PPLA (`N`, `q`, `Q`, `A`, `B`, `P1`)
  - **GoDEX**: EZPL (`^Q`, `^W`, `AH`, `BA`, `BQ`, `E`)
  - **HPRT**: TSPL (`SIZE`, `GAP`, `SPEED`, `DENSITY`, `BARCODE`)

- **Métodos de Comunicação:**
  - **Agente Spooler Local (Recomendado)**: Lista automaticamente as impressoras instaladas no Windows / Linux / macOS em um menu dropdown e imprime via Spooler do SO.
  - **Web Serial API**: Conexão direta com portas COM / USB Serial no navegador.
  - **WebUSB API**: Comunicação USB direta de baixa linha com a impressora.
  - **Web Bluetooth API**: Impressão sem fio via Bluetooth.
  - **Rede Direct (TCP / HTTP REST)**: Envio direto via IP na porta `9100`.

---

## 📂 Estrutura do Projeto

```
.
├── agent/
│   ├── server.js            # Agente Spooler Local em Node.js (8182)
│   └── server.py            # Agente Spooler Local em Python (8182)
├── css/
│   └── style.css            # Estilos da interface web
├── js/
│   └── label-printer.js     # Biblioteca principal client-side
├── test/
│   └── label-printer.test.js # Testes unitários
├── index.html               # Aplicação web com dropdown de impressoras
└── README.md                # Documentação
```

---

## 🛠️ Exemplo de Uso em JavaScript

```javascript
// 1. Listar impressoras instaladas no sistema via Agente
const impressoras = await LabelPrinter.transports.LocalAgent.discoverPrinters();
console.log('Impressoras no SO:', impressoras);

// 2. Gerar comando ZPL para Zebra
const zpl = LabelPrinter.generators.zebra.generateLabel({
  title: 'PRODUTO MODELO A',
  barcode: '7891234567890',
  qrCode: 'https://exemplo.com.br/l/123',
  details: ['LOTE: 2023-A', 'VAL: 12/2026']
});

// 3. Imprimir na Zebra escolhida no dropdown
const transport = new LabelPrinter.transports.LocalAgent({ printerName: 'Zebra_GK420t' });
const printer = new LabelPrinter(transport);
await printer.print(zpl);
```

---

## 🧪 Executando os Testes

```bash
node test/label-printer.test.js
```
