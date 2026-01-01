// Card colors match god order by importance
// Val 2: Afrodita (pink), Artemisa (lightblue), Dionisio (green)
// Val 3: Ares (red), Atenea (gold)
// Val 4: Hades (purple)
// Val 5: Zeus (yellow) - Most important
const cards = [
  { id: 1, value: 2, color: "pink" },       // Afrodita
  { id: 2, value: 2, color: "pink" },
  { id: 3, value: 2, color: "lightblue" },  // Artemisa
  { id: 4, value: 2, color: "lightblue" },
  { id: 5, value: 2, color: "green" },      // Dionisio
  { id: 6, value: 2, color: "green" },
  { id: 7, value: 3, color: "red" },        // Ares
  { id: 8, value: 3, color: "red" },
  { id: 9, value: 3, color: "red" },
  { id: 10, value: 3, color: "gold" },      // Atenea
  { id: 11, value: 3, color: "gold" },
  { id: 12, value: 3, color: "gold" },
  { id: 13, value: 4, color: "purple" },    // Hades
  { id: 14, value: 4, color: "purple" },
  { id: 15, value: 4, color: "purple" },
  { id: 16, value: 4, color: "purple" },
  { id: 17, value: 5, color: "yellow" },    // Zeus
  { id: 18, value: 5, color: "yellow" },
  { id: 19, value: 5, color: "yellow" },
  { id: 20, value: 5, color: "yellow" },
  { id: 21, value: 5, color: "yellow" },
];

const deckIndex = cards.map((card) => card.id);

module.exports = {
  cards,
  deckIndex,
};
