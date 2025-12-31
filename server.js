const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { shuffle } = require("./utils");
const { cards, deckIndex } = require("./constants");
const { handle } = require("express/lib/application");

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
    currentSocket.emit("drawn-card", { cardId: drawnCard, deck: game.deck });
    opponentSocket.emit("oponent-hand-updated", {
      hand: game.hands[currentSocket.id],
      deck: game.deck,
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
  const discarded = [shuffledDeck.pop()];
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
    actions: {
      [player1.id]: [1, 2, 3, 4],
      [player2.id]: [1, 2, 3, 4],
    },
    scoredCards: {
      [player1.id]: [],
      [player2.id]: [],
    },
    secretCard: {
      [player1.id]: null,
      [player2.id]: null,
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
    deck: shuffledDeck,
    availableActions: [1, 2, 3, 4],
    opponentAvailableActions: [1, 2, 3, 4],
    secretCard: null,
    scoredCards: [],
    opponentScoredCards: [],
    config: { allCards: cards },
  });

  player2.emit("game-start", {
    role: "opponent",
    hand: player2Hand,
    opponentHand: player1Hand,
    discarded,
    deck: shuffledDeck,
    availableActions: [1, 2, 3, 4],
    opponentAvailableActions: [1, 2, 3, 4],
    secretCard: null,
    scoredCards: [],
    opponentScoredCards: [],
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

  const handleGiftAction = (player) => {
    player.on("trigger-gift-action", ({ pickedCards }) => {
      const opponent = findOpponent(player);
      opponent.emit("resolve-gift-action", {
        pickedCards,
      });
    });
  };

  const handleEndGiftAction = (player) => {
    player.on("end-gift-action", ({ cardsToPick, pickedCard }) => {
      const opponent = findOpponent(player);

      const game = gameStates.get(opponent.id);
      if (!game) return;

      game.hands[opponent.id] = game.hands[opponent.id].filter(
        (carId) => !cardsToPick.find((c) => c.id === carId)
      );

      game.actions[opponent.id] = game.actions[opponent.id].filter(
        (action) => action !== 3
      );

      game.scoredCards[player.id] = [
        ...gameStates.get(player.id).scoredCards[player.id],
        pickedCard,
      ];

      game.scoredCards[opponent.id] = [
        ...gameStates.get(opponent.id).scoredCards[opponent.id],
        ...cardsToPick.filter((card) => card.id !== pickedCard.id),
      ];

      opponent.emit("gift-action-clean-up", {
        hand: game.hands[opponent.id],
        opponentHand: gameStates.get(player.id).hands[player.id],
        availableActions: game.actions[opponent.id],
        opponentAvailableActions: gameStates.get(player.id).actions[player.id],
        scoredCards: game.scoredCards[opponent.id],
        opponentScoredCards: game.scoredCards[player.id],
      });

      player.emit("gift-action-clean-up", {
        hand: gameStates.get(player.id).hands[player.id],
        opponentHand: game.hands[opponent.id],
        availableActions: gameStates.get(player.id).actions[player.id],
        opponentAvailableActions: game.actions[opponent.id],
        scoredCards: game.scoredCards[player.id],
        opponentScoredCards: game.scoredCards[opponent.id],
      });

      endTurn(opponent.id);
    });
  };

  const handleSecretAction = (player) => {
    player.on("trigger-secret-action", ({ pickedCard }) => {
      const opponent = findOpponent(player);

      const game = gameStates.get(player.id);
      if (!game) return;

      game.hands[player.id] = game.hands[player.id].filter(
        (cardId) => cardId !== pickedCard.id
      );

      game.actions[player.id] = game.actions[player.id].filter(
        (action) => action !== 1
      );

      player.emit("secret-action-clean-up", {
        hand: game.hands[player.id],
        availableActions: game.actions[player.id],
        secretCard: pickedCard,
      });

      opponent.emit("update-opponent-available-actions", {
        opponentAvailableActions: game.actions[player.id],
      });

      endTurn(player.id);
    });
  };

  handleHover(player1);
  handleHover(player2);
  handleEndTurn(player1);
  handleEndTurn(player2);
  handleGiftAction(player1);
  handleGiftAction(player2);
  handleEndGiftAction(player1);
  handleEndGiftAction(player2);
  handleSecretAction(player1);
  handleSecretAction(player2);

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
