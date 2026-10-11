const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "application/json"
  });
  res.end(JSON.stringify({
    status: "online",
    jogo: "Sobrevivencia 3D"
  }));
});

const wss = new WebSocket.Server({
  server,
  path: "/ws"
});

const salas = new Map();

function enviar(ws, dados) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(dados));
  }
}

function codigoSala() {
  let codigo;
  do {
    codigo = String(
      crypto.randomInt(0, 100000)
    ).padStart(5, "0");
  } while (salas.has(codigo));
  return codigo;
}

function jogadores(sala) {
  return [...sala.jogadores]
    .filter(j => j.readyState === WebSocket.OPEN)
    .length;
}

function listaPublica() {
  return [...salas.entries()]
    .filter(([codigo, sala]) => sala.publica)
    .map(([codigo, sala]) => ({
      nome: sala.nome,
      codigo,
      jogadores: jogadores(sala)
    }));
}

function sair(ws) {
  if (!ws.sala) return;

  const sala = salas.get(ws.sala);
  if (sala) {
    sala.jogadores.delete(ws);

    if (sala.jogadores.size === 0) {
      salas.delete(ws.sala);
    } else {
      sala.jogadores.forEach(j =>
        enviar(j, {
          tipo: "jogadores",
          total: jogadores(sala)
        })
      );
    }
  }

  ws.sala = null;
}

wss.on("connection", ws => {
  ws.on("message", dados => {
    let msg;

    try {
      msg = JSON.parse(dados.toString());
    } catch {
      return enviar(ws, {
        tipo: "erro",
        mensagem: "Mensagem invalida"
      });
    }

    if (!msg || typeof msg.tipo !== "string") return;

    if (msg.tipo === "listar") {
      return enviar(ws, {
        tipo: "servidores",
        servidores: listaPublica()
      });
    }

    if (msg.tipo === "criar") {
      sair(ws);

      if (salas.size >= 100) {
        return enviar(ws, {
          tipo: "erro",
          mensagem: "Limite de salas atingido"
        });
      }

      const nome = String(msg.nome || "")
        .trim().slice(0, 30);

      if (!nome) {
        return enviar(ws, {
          tipo: "erro",
          mensagem: "Informe o nome da sala"
        });
      }

      const privada = msg.privado === true;
      const senha = String(msg.senha || "").slice(0, 64);
      const codigo = codigoSala();

      const sala = {
        nome,
        publica: !privada,
        senha,
        jogadores: new Set()
      };

      salas.set(codigo, sala);
      sala.jogadores.add(ws);
      ws.sala = codigo;

      return enviar(ws, {
        tipo: "criada",
        nome,
        codigo: privada ? codigo : null,
        privada,
        total: 1
      });
    }

    if (msg.tipo === "entrar") {
      sair(ws);

      const codigo = String(msg.codigo || "");
      const sala = salas.get(codigo);

      if (!sala) {
        return enviar(ws, {
          tipo: "erro",
          mensagem: "Sala nao encontrada"
        });
      }

      if (sala.senha &&
          sala.senha !== String(msg.senha || "")) {
        return enviar(ws, {
          tipo: "erro",
          mensagem: "Senha incorreta"
        });
      }

      if (sala.jogadores.size >= 16) {
        return enviar(ws, {
          tipo: "erro",
          mensagem: "Sala cheia"
        });
      }

      sala.jogadores.add(ws);
      ws.sala = codigo;

      enviar(ws, {
        tipo: "entrou",
        nome: sala.nome,
        codigo,
        total: jogadores(sala)
      });

      sala.jogadores.forEach(j => {
        enviar(j, {
          tipo: "jogadores",
          total: jogadores(sala)
        });
      });

      return;
    }

    if (msg.tipo === "jogo") {
      if (!ws.sala) return;

      const sala = salas.get(ws.sala);
      if (!sala) return;

      const conteudo = JSON.stringify({
        tipo: "jogo",
        dados: msg.dados
      });

      sala.jogadores.forEach(j => {
        if (j !== ws &&
            j.readyState === WebSocket.OPEN) {
          j.send(conteudo);
        }
      });
    }
  });

  ws.on("close", () => sair(ws));
});

const porta = process.env.PORT || 10000;

server.listen(porta, "0.0.0.0", () => {
  console.log("Servidor online na porta " + porta);
});
