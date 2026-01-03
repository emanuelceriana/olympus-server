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

const PORT = process.env.PORT || 3001;

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Room-based matchmaking
const rooms = new Map(); // roomId -> { id, name, host, guest, gameState, createdAt }
const playerRooms = new Map(); // socket.id -> roomId
const games = new Map(); // socket.id -> opponent socket
const gameStates = new Map(); // socket.id -> gameState

// Generate unique room ID
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function findOpponent(socket) {
  return games.get(socket.id) || null;
}

function notifyOpponentHandUpdate(socket, game) {
    const opponent = findOpponent(socket);
    if (!opponent) return;
    
    // Notify opponent about MY hand (which is opponentHand for them)
    // The event 'oponent-hand-updated' expects { hand, deck }
    // Sending game.hands[socket.id]
    opponent.emit("oponent-hand-updated", {
        hand: game.hands[socket.id],
        deck: game.deck
    });
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
  checkEndRound(game);
}

function checkEndRound(game) {
  const p1Id = Object.keys(game.players)[0];
  const p2Id = Object.keys(game.players)[1];

  // Check if both players have used all actions
  if (game.actions[p1Id].length === 0 && game.actions[p2Id].length === 0) {
    console.log("Round End! Calculating scores...");

    // 1. Reveal Secret Cards
    if (game.secretCard[p1Id]) {
      game.scoredCards[p1Id].push(game.secretCard[p1Id]);
      game.secretCard[p1Id] = null;
    }
    if (game.secretCard[p2Id]) {
      game.scoredCards[p2Id].push(game.secretCard[p2Id]);
      game.secretCard[p2Id] = null;
    }

    // 2. Calculate Favors
    const cardTypes = [
      { color: "pink", value: 2 },
      { color: "yellow", value: 2 },
      { color: "lightblue", value: 2 },
      { color: "blue", value: 3 },
      { color: "red", value: 3 },
      { color: "green", value: 4 },
      { color: "purple", value: 5 },
    ];

    cardTypes.forEach((type) => {
      const p1Count = game.scoredCards[p1Id].filter(
        (c) => c.color === type.color
      ).length;
      const p2Count = game.scoredCards[p2Id].filter(
        (c) => c.color === type.color
      ).length;

      if (p1Count > p2Count) {
        game.favors[type.color] = p1Id;
      } else if (p2Count > p1Count) {
        game.favors[type.color] = p2Id;
      }
      // If tie, favor remains unchanged (null or previous owner)
    });

    // 3. Check Win Condition
    const checkWin = (playerId) => {
      let favorCount = 0;
      let pointsCount = 0;

      cardTypes.forEach((type) => {
        if (game.favors[type.color] === playerId) {
          favorCount++;
          pointsCount += type.value;
        }
      });

      return { favorCount, pointsCount };
    };

    const p1Stats = checkWin(p1Id);
    const p2Stats = checkWin(p2Id);

    console.log(`P1: ${p1Stats.favorCount} favors, ${p1Stats.pointsCount} points`);
    console.log(`P2: ${p2Stats.favorCount} favors, ${p2Stats.pointsCount} points`);

    let winner = null;
    // Standard rule: 11 points OR 4 favors.
    // Prioritize 11 points if both meet? Or just simultaneous?
    // Rule: "If one player collects 4 geishas and the other 11 points, the player with 11 points wins."
    const p1WinFavors = p1Stats.favorCount >= 4;
    const p1WinPoints = p1Stats.pointsCount >= 11;
    const p2WinFavors = p2Stats.favorCount >= 4;
    const p2WinPoints = p2Stats.pointsCount >= 11;

    if ((p1WinPoints && !p2WinPoints) || (p1WinFavors && !p2WinPoints && !p2WinFavors)) {
        winner = p1Id;
    } else if ((p2WinPoints && !p1WinPoints) || (p2WinFavors && !p1WinPoints && !p1WinFavors)) {
        winner = p2Id;
    } else if (p1WinPoints && p2WinPoints) {
       // Both > 11 points? Tie? Or higher points? Standard says 11 points wins over 4 geishas.
       // What if both have 11 points? Usually tie/continue.
       if (p1Stats.pointsCount > p2Stats.pointsCount) winner = p1Id;
       else if (p2Stats.pointsCount > p1Stats.pointsCount) winner = p2Id;
    }

    // Send updated favors to clients
    // Send updated favors to clients
    Object.values(game.players).forEach(player => {
        const opponent = findOpponent(player);
        player.emit("round-end", {
            favors: game.favors,
            scoredCards: game.scoredCards[player.id], 
            opponentScoredCards: game.scoredCards[opponent.id],
            isGameOver: !!winner // Tell client if this is the final round
        });
    });

    if (winner) {
        // Emit game-over immediately - client handles delay
        io.emit("game-over", { winner });
        games.delete(p1Id);
        games.delete(p2Id); 
        gameStates.delete(p1Id);
        gameStates.delete(p2Id);
    } else {
        // Start New Round
        setTimeout(() => startNewRound(game), 3000); // 3s delay to see results
    }
  }
}

function startNewRound(game) {
   const p1Id = Object.keys(game.players)[0];
   const p2Id = Object.keys(game.players)[1];
   
   // Reset Deck
   const shuffledDeck = shuffle([...deckIndex]);
   const discarded = [shuffledDeck.pop()];
   const p1Hand = shuffledDeck.splice(0, 6);
   const p2Hand = shuffledDeck.splice(0, 6);

   // Reset Game State (preserve favors)
   game.deck = shuffledDeck;
   game.discarded = discarded;
   game.hands[p1Id] = p1Hand;
   game.hands[p2Id] = p2Hand;
   game.actions[p1Id] = [1, 2, 3, 4];
   game.actions[p2Id] = [1, 2, 3, 4];
   game.scoredCards[p1Id] = [];
   game.scoredCards[p2Id] = [];
   game.secretCard[p1Id] = null;
   game.playerDiscards[p1Id] = [];
   game.playerDiscards[p2Id] = [];
   
   game.players[p1Id].emit("new-round", {
     hand: p1Hand,
     opponentHand: p2Hand, // sizes only?
     discarded,
     myDiscarded: [],
     deck: shuffledDeck, // sizes
     availableActions: [1,2,3,4],
     opponentAvailableActions: [1,2,3,4],
     favors: game.favors
   });

   game.players[p2Id].emit("new-round", {
     hand: p2Hand,
     opponentHand: p1Hand,
     discarded,
     myDiscarded: [],
     deck: shuffledDeck,
     availableActions: [1,2,3,4],
     opponentAvailableActions: [1,2,3,4],
     favors: game.favors
   });
   
   startTurn(game.currentTurn);
}

io.on("connection", (socket) => {
  console.log("A user connected", socket.id);
  console.log("Sockets conectados:", io.sockets.sockets.size);

  // ==================== LOBBY EVENTS ====================
  
  // Get list of available rooms
  socket.on("get-rooms", () => {
    const roomList = [];
    rooms.forEach((room, id) => {
      roomList.push({
        id: room.id,
        name: room.name,
        hostId: room.host.id,
        playerCount: room.guest ? 2 : 1,
        createdAt: room.createdAt
      });
    });
    // Sort by creation time (newest first)
    roomList.sort((a, b) => b.createdAt - a.createdAt);
    socket.emit("rooms-list", { rooms: roomList });
  });

  // Create a new room
  socket.on("create-room", ({ roomName }) => {
    // Check if player is already in a room
    if (playerRooms.has(socket.id)) {
      socket.emit("room-error", { message: "You are already in a room" });
      return;
    }

    const roomId = generateRoomId();
    const room = {
      id: roomId,
      name: roomName || `Room ${roomId}`,
      host: socket,
      guest: null,
      gameState: null,
      createdAt: Date.now()
    };

    rooms.set(roomId, room);
    playerRooms.set(socket.id, roomId);

    socket.emit("room-created", { 
      roomId, 
      roomName: room.name,
      message: "Room created! Waiting for opponent..." 
    });

    // Broadcast updated room list to all clients
    io.emit("rooms-updated");
    console.log(`Room ${roomId} created by ${socket.id}`);
  });

  // Join an existing room
  socket.on("join-room", ({ roomId }) => {
    const room = rooms.get(roomId);

    if (!room) {
      socket.emit("room-error", { message: "Room not found" });
      return;
    }

    if (room.guest) {
      socket.emit("room-error", { message: "Room is full" });
      return;
    }

    if (room.host.id === socket.id) {
      socket.emit("room-error", { message: "You cannot join your own room" });
      return;
    }

    // Join the room
    room.guest = socket;
    playerRooms.set(socket.id, roomId);

    console.log(`${socket.id} joined room ${roomId}`);

    // Start the game!
    startGameInRoom(room);
  });

  // Leave a room (before game starts)
  socket.on("leave-room", () => {
    const roomId = playerRooms.get(socket.id);
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    // If host leaves, delete the room
    if (room.host.id === socket.id) {
      rooms.delete(roomId);
      playerRooms.delete(socket.id);
      if (room.guest) {
        playerRooms.delete(room.guest.id);
        room.guest.emit("room-closed", { message: "Host left the room" });
      }
    } else if (room.guest && room.guest.id === socket.id) {
      // Guest leaves
      room.guest = null;
      playerRooms.delete(socket.id);
    }

    io.emit("rooms-updated");
  });

  // ==================== GAME START FUNCTION ====================
  
  function startGameInRoom(room) {
    const player1 = room.host;
    const player2 = room.guest;

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
      playerDiscards: {
        [player1.id]: [],
        [player2.id]: [],
      },
      currentTurn: player1.id,
      favors: {},
      roomId: room.id
    };

    room.gameState = gameState;
    gameStates.set(player1.id, gameState);
    gameStates.set(player2.id, gameState);

    player1.emit("game-start", {
      role: "player",
      hand: player1Hand,
      opponentHand: player2Hand,
      discarded,
      myDiscarded: [],
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
      myDiscarded: [],
      deck: shuffledDeck,
      availableActions: [1, 2, 3, 4],
      opponentAvailableActions: [1, 2, 3, 4],
      secretCard: null,
      scoredCards: [],
      opponentScoredCards: [],
      config: { allCards: cards },
    });

    // Remove room from lobby (game started)
    io.emit("rooms-updated");

    // Start first turn
    setTimeout(() => startTurn(player1.id), 1000);

    // ==================== REGISTER GAME EVENT HANDLERS ====================
    
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

        notifyOpponentHandUpdate(player, game);

        endTurn(player.id);
      });
    };

    const handleDiscardAction = (player) => {
      player.on("trigger-discard-action", ({ pickedCards }) => {
        const opponent = findOpponent(player);

        const game = gameStates.get(player.id);
        if (!game) return;

        game.hands[player.id] = game.hands[player.id].filter(
          (cardId) => !pickedCards.find((c) => c.id === cardId)
        );

        game.actions[player.id] = game.actions[player.id].filter(
          (action) => action !== 2
        );

        game.discarded = [
          ...game.discarded,
          ...pickedCards.map((c) => c.id),
        ];

        game.playerDiscards[player.id] = [
          ...game.playerDiscards[player.id],
          ...pickedCards.map((c) => c.id),
        ];

        player.emit("discard-action-clean-up", {
          hand: game.hands[player.id],
          availableActions: game.actions[player.id],
          discarded: game.discarded,
          myDiscarded: game.playerDiscards[player.id],
        });

        opponent.emit("update-opponent-available-actions", {
          opponentAvailableActions: game.actions[player.id],
        });

        opponent.emit("update-discarded", {
          discarded: game.discarded,
        });

        notifyOpponentHandUpdate(player, game);

        endTurn(player.id);
      });
    };

    const handleCompetitionAction = (player) => {
      player.on("trigger-competition-action", ({ pickedCards }) => {
        const opponent = findOpponent(player);
        opponent.emit("resolve-competition-action", {
          pickedCards,
        });
      });
    };

    const handleEndCompetitionAction = (player) => {
      player.on("end-competition-action", ({ chosenSetIndex, pickedCards }) => {
        const opponent = findOpponent(player);

        const game = gameStates.get(player.id);
        if (!game) return;

        const chosenSet = pickedCards[chosenSetIndex];
        const rejectedSet = pickedCards[chosenSetIndex === 0 ? 1 : 0];

        const allFourCards = [...pickedCards[0], ...pickedCards[1]];
        game.hands[opponent.id] = game.hands[opponent.id].filter(
          (cardId) => !allFourCards.find((c) => c.id === cardId)
        );

        game.actions[opponent.id] = game.actions[opponent.id].filter(
          (action) => action !== 4
        );

        game.scoredCards[player.id] = [
          ...gameStates.get(player.id).scoredCards[player.id],
          ...chosenSet,
        ];

        game.scoredCards[opponent.id] = [
          ...gameStates.get(opponent.id).scoredCards[opponent.id],
          ...rejectedSet,
        ];

        player.emit("competition-action-clean-up", {
          hand: game.hands[player.id],
          opponentHand: game.hands[opponent.id],
          availableActions: game.actions[player.id],
          opponentAvailableActions: game.actions[opponent.id],
          scoredCards: game.scoredCards[player.id],
          opponentScoredCards: game.scoredCards[opponent.id],
        });

        opponent.emit("competition-action-clean-up", {
          hand: game.hands[opponent.id],
          opponentHand: game.hands[player.id],
          availableActions: game.actions[opponent.id],
          opponentAvailableActions: game.actions[player.id],
          scoredCards: game.scoredCards[opponent.id],
          opponentScoredCards: game.scoredCards[player.id],
        });

        endTurn(player.id);
      });
    };

    const handleDisconnect = (player, label) => {
      console.log(`${label} disconnected`, player.id);
      const opponent = findOpponent(player);
      if (opponent) {
        opponent.emit("opponent-disconnected");
        games.delete(opponent.id);
        gameStates.delete(opponent.id);
        playerRooms.delete(opponent.id);
      }
      games.delete(player.id);
      gameStates.delete(player.id);
      playerRooms.delete(player.id);
      
      // Clean up room
      if (room.id) {
        rooms.delete(room.id);
      }
    };

    // Register all handlers for both players
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
    handleDiscardAction(player1);
    handleDiscardAction(player2);
    handleCompetitionAction(player1);
    handleCompetitionAction(player2);
    handleEndCompetitionAction(player1);
    handleEndCompetitionAction(player2);

    player1.on("disconnect", () => handleDisconnect(player1, "Player 1"));
    player2.on("disconnect", () => handleDisconnect(player2, "Player 2"));
  }

  // ==================== LOBBY DISCONNECT HANDLER ====================
  socket.on("disconnect", () => {
    console.log("User disconnected", socket.id);
    
    // Check if player was in a room (not in game)
    const roomId = playerRooms.get(socket.id);
    if (roomId) {
      const room = rooms.get(roomId);
      if (room && !room.gameState) {
        // Room exists and game hasn't started
        if (room.host.id === socket.id) {
          // Host disconnected, delete room
          rooms.delete(roomId);
          if (room.guest) {
            playerRooms.delete(room.guest.id);
            room.guest.emit("room-closed", { message: "Host disconnected" });
          }
        } else if (room.guest && room.guest.id === socket.id) {
          // Guest disconnected
          room.guest = null;
        }
        io.emit("rooms-updated");
      }
      playerRooms.delete(socket.id);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

