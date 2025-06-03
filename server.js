const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { shuffle } = require("./utils");
const { cards, deckIndex } = require("./constants");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

const PORT = 3001;

let waitingPlayer = null;
const games = new Map(); // socket.id -> opponent socket
const gameStates = new Map(); // socket.id -> gameState

function findOpponent(socket) {
  return games.get(socket.id) || null;
}

function startTurn(socketId) {
  const game = gameStates.get(socketId);
  if (!game) return;

  const currentSocket = game.players[game.currentTurn];
  const opponentSocket = findOpponent(currentSocket);

  if (game.deck.length > 0) {
    const drawnCard = game.deck.pop();
    game.hands[currentSocket.id].push(drawnCard);
    currentSocket.emit("drawn-card", { cardId: drawnCard });
    opponentSocket.emit("oponent-hand-updated", {
      hand: game.hands[currentSocket.id],
    });
  }

  for (const id in game.players) {
    game.players[id].emit("turn-start", { myTurn: id === game.currentTurn });
  }
}

function endTurn(socketId) {
  const game = gameStates.get(socketId);
  if (!game) return;

  const ids = Object.keys(game.players);
  const currentIndex = ids.indexOf(game.currentTurn);
  const nextIndex = (currentIndex + 1) % ids.length;
  game.currentTurn = ids[nextIndex];

  startTurn(ids[nextIndex]);
}

io.on("connection", (socket) => {
  console.log("A user connected", socket.id);
  console.log("Sockets conectados:", io.sockets.sockets.size);

  if (!waitingPlayer) {
    waitingPlayer = socket;
    socket.emit("waiting", { message: "Esperando oponente..." });

    socket.on("disconnect", () => {
      console.log("User disconnected (was waiting)", socket.id);
      if (waitingPlayer === socket) {
        waitingPlayer = null;
      }
    });

    return;
  }

  const player1 = waitingPlayer;
  const player2 = socket;
  waitingPlayer = null;

  games.set(player1.id, player2);
  games.set(player2.id, player1);

  const shuffledDeck = shuffle([...deckIndex]);
  const discarded = shuffledDeck.pop();
  const player1Hand = shuffledDeck.splice(0, 6);
  const player2Hand = shuffledDeck.splice(0, 6);

  const gameState = {
    deck: shuffledDeck,
    discarded,
    players: {
      [player1.id]: player1,
      [player2.id]: player2,
    },
    hands: {
      [player1.id]: player1Hand,
      [player2.id]: player2Hand,
    },
    currentTurn: player1.id,
  };

  gameStates.set(player1.id, gameState);
  gameStates.set(player2.id, gameState);

  player1.emit("game-start", {
    role: "player",
    hand: player1Hand,
    opponentHand: player2Hand,
    discarded,
    config: { allCards: cards },
  });

  player2.emit("game-start", {
    role: "opponent",
    hand: player2Hand,
    opponentHand: player1Hand,
    discarded,
    config: { allCards: cards },
  });

  // Iniciar turno automático
  setTimeout(() => startTurn(player1.id), 1000);

  const handleHover = (player) => {
    player.on("hover-card", ({ index }) => {
      const opponent = findOpponent(player);
      if (opponent) opponent.emit("opponent-hover", { index });
    });
  };

  const handleEndTurn = (player) => {
    player.on("end-turn", () => {
      endTurn(player.id);
    });
  };

  handleHover(player1);
  handleHover(player2);
  handleEndTurn(player1);
  handleEndTurn(player2);

  const handleDisconnect = (player, label) => {
    console.log(`${label} disconnected`, player.id);
    const opponent = findOpponent(player);
    if (opponent) {
      opponent.emit("opponent-disconnected");
      games.delete(opponent.id);
      gameStates.delete(opponent.id);
    }
    games.delete(player.id);
    gameStates.delete(player.id);
  };

  player1.on("disconnect", () => handleDisconnect(player1, "Player 1"));
  player2.on("disconnect", () => handleDisconnect(player2, "Player 2"));
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
