const cards = [
  { id: 1, value: 2, color: "pink" },
  { id: 2, value: 2, color: "pink" },
  { id: 3, value: 2, color: "yellow" },
  { id: 4, value: 2, color: "yellow" },
  { id: 5, value: 2, color: "lightblue" },
  { id: 6, value: 2, color: "lightblue" },
  { id: 7, value: 3, color: "blue" },
  { id: 8, value: 3, color: "blue" },
  { id: 9, value: 3, color: "blue" },
  { id: 10, value: 3, color: "red" },
  { id: 11, value: 3, color: "red" },
  { id: 12, value: 3, color: "red" },
  { id: 13, value: 4, color: "green" },
  { id: 14, value: 4, color: "green" },
  { id: 15, value: 4, color: "green" },
  { id: 16, value: 4, color: "green" },
  { id: 17, value: 5, color: "purple" },
  { id: 18, value: 5, color: "purple" },
  { id: 19, value: 5, color: "purple" },
  { id: 20, value: 5, color: "purple" },
  { id: 21, value: 5, color: "purple" },
];

const deckIndex = cards.map((card) => card.id);

module.exports = {
  cards,
  deckIndex,
};
