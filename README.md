# Universal Client-Side Thermal Label Printer Library & Demo

Solução multiplataforma e 100% no lado do cliente (browser) em JavaScript para listagem, geração de linguagem de comando e impressão em impressoras térmicas de etiquetas das marcas **Zebra, Elgin, Argox, GoDEX, HPRT** e similares.

---

## 🖨️ Impressão na Rede & Solução para Impressoras HPRT / Zebra no Windows

Quando uma impressora térmica (como HPRT ou Zebra) está instalada no Windows e compartilhada na rede por outro computador, os drivers do Windows por padrão esperam documentos formatados (GDI) e descartam dados térmicos brutos (RAW/TSPL/ZPL).

O agente local do projeto utiliza diretamente a API Nativa de Spooler do Windows (`winspool.drv` com `pDatatype = "RAW"`), garantindo que os comandos de etiquetas enviados do navegador passem **sem alterações ou corrupção de dados diretamente para impressoras locais ou da rede compartilhada**.

---

## 🚀 Como Exibir a Lista de Impressoras no Dropdown

Para listar automaticamente as impressoras instaladas no sistema operacional (Windows, Linux, macOS) e impressoras compartilhadas da rede:

### Execute o Agente Spooler Local (Incluído no Projeto)

Você pode executar o agente em **Node.js** ou **Python**:

#### Via Node.js:
```bash
node agent/server.js
```

#### Via Python:
```bash
python agent/server.py
```

O agente rodará em `http://127.0.0.1:8182` e irá:
- Consultar o sistema operacional e listar todas as impressoras.
- Enviar o fluxo RAW (ZPL, TSPL, PPLB, EZPL) diretamente para o spooler da impressora selecionada no menu.

---

## 💻 Funcionalidades & Interfaces Suportadas

- **Suporte Multi-Marca & Multi-Linguagem:**
  - **Zebra**: ZPL II (`^XA...^XZ`)
  - **Elgin**: TSPL / ZPL (`SIZE`, `GAP`, `BARCODE`, `TEXT`)
  - **Argox**: PPLB / PPLA (`N`, `q`, `Q`, `A`, `B`, `P1`)
  - **GoDEX**: EZPL (`^Q`, `^W`, `AH`, `BA`, `BQ`, `E`)
  - **HPRT**: TSPL / ZPL (`SIZE`, `GAP`, `SPEED`, `DENSITY`, `BARCODE`)

- **Métodos de Comunicação:**
  - **Agente Spooler Local (Recomendado para Windows/Linux/macOS e Rede)**: Lista automaticamente no dropdown e realiza spooling RAW nativo via `winspool.drv` ou `lpr -o raw`.
  - **Web Serial API**: Conexão direta com portas COM / USB Serial no navegador.
  - **WebUSB API**: Comunicação USB direta de baixa linha.
  - **Web Bluetooth API**: Impressão sem fio via Bluetooth.
  - **Rede Direct (TCP / HTTP REST)**: Envio direto via IP na porta `9100`.

---

## 📂 Estrutura do Projeto

```
.
├── agent/
│   ├── server.js            # Agente Spooler Local em Node.js (Win32 RAW / CUPS)
│   └── server.py            # Agente Spooler Local em Python (Win32 ctypes / CUPS)
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

## 🧪 Executando os Testes

```bash
node test/label-printer.test.js
```
