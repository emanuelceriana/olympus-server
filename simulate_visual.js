const puppeteer = require('puppeteer');

(async () => {
  const browser1 = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--window-size=900,1000', '--window-position=0,0']
  });
  
  const browser2 = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--window-size=900,1000', '--window-position=900,0']
  });

  const page1 = await browser1.newPage();
  const page2 = await browser2.newPage();

  console.log('--- Starting Full Game Simulation ---');

  await page1.goto('http://localhost:5173');
  await page2.goto('http://localhost:5173');

  const wait = (ms) => new Promise(res => setTimeout(res, ms));
  await wait(1500);

  console.log('--- HANDLING LOBBY ---');

  // Player 1 Creates Room
  console.log('P1: Creating Room...');
  const createBtn = await page1.$('.create-section button');
  if (createBtn) {
      await createBtn.click();
      console.log('P1 clicked Create');
  } else {
      console.error('Create button not found!');
  }
  
  await wait(1000); // Wait for room to appear in list

  // Player 2 Joins Room
  console.log('P2: Joining Room...');
  // Find the first available room in the list and click "Join"
  // Selector fixed: .room-card .btn-join
  const joinBtn = await page2.$('.room-card .btn-join');
  if (joinBtn) {
      await joinBtn.click();
      console.log('P2 clicked Join');
  } else {
      console.error('Join button not found! (Is the room list empty? Selector: .room-card .btn-join)');
  }

  await wait(2000); // Wait for game to initialize

  // --- Helper Functions ---

  async function clickAction(page, actionIndex) {
      const actions = await page.$$('.player-actions button');
      if (actions[actionIndex]) {
          await actions[actionIndex].click();
          await wait(200);
          console.log(`Clicked Action ${actionIndex}`);
          return true;
      } else {
          console.log(`Action ${actionIndex} button not found!`);
      }
      return false;
  }

  async function pickCards(page, count) {
      for (let i = 0; i < count; i++) {
          // Re-query cards every time because React re-renders might detach nodes
          const cards = await page.$$('.player-hand .card:not(.selected)'); 
          // Note: using :not(.selected) if there's a selected class, 
          // or just picking the first available unpicked card logic.
          // Since clicking usually selects/removes or marks it.
          // In this game, clicking adds to 'pickedCards' state and usually stays in hand with a style 
          // OR purely relies on index. 
          // Let's just grab all and pick the ith one, 
          // BUT since the DOM might have fully refreshed, we grab them again.
          const freshCards = await page.$$('.player-hand .card');
          
          // We need to pick different cards. 
          // Since cards are removed from the hand list in the UI when picked,
          // the card at index 0 is always the *next* available card.
          // Iterating i=0,1,2 would maintain the offset but effectively skip cards (0, then new 1 which was 2, etc.)
          // So we simply click index 0 repeatedly!
          if (freshCards[0]) {
              await freshCards[0].click();
              await wait(150);
          }
      }
      await wait(200);
  }

  async function confirmAction(page) {
      const btn = await page.$('.action-confirm-btn');
      if (btn) await btn.click();
      await wait(200);
  }

  // --- Action Scripts ---

  async function doSecret(pLabel, page) {
      console.log(`${pLabel}: Secret Action`);
      if (await clickAction(page, 0)) {
          await pickCards(page, 1);
          await confirmAction(page);
      }
      await wait(1000);
  }

  async function doDiscard(pLabel, page) {
      console.log(`${pLabel}: Discard Action`);
      if (await clickAction(page, 1)) {
          await pickCards(page, 2);
          await confirmAction(page);
      }
      await wait(1000);
  }

  async function doGift(pLabel, pPage, oLabel, oPage) {
      console.log(`${pLabel}: Gift Action (Offer)`);
      // P1 picks 3 cards
      if (await clickAction(pPage, 2)) {
          await pickCards(pPage, 3);
          await confirmAction(pPage);
          console.log(`${pLabel} offered Gift. Waiting for ${oLabel}...`);
          
          await wait(800);
          
          // Opponent chooses 1
          console.log(`${oLabel}: Choosing Gift`);
          // Using specific selector for Gift Resolver
          const giftCards = await oPage.$$('.resolver-cards .card');
          if (giftCards[0]) {
              await giftCards[0].click();
              console.log(`${oLabel} Clicked Gift Card`);
              await wait(200);
              // Gift trigger is immediate, no confirmation needed
          } else {
              console.log(`${oLabel} Gift Cards not found`);
          }
      }
      await wait(1000);
  }

  async function doCompetition(pLabel, pPage, oLabel, oPage) {
      console.log(`${pLabel}: Competition Action (Offer)`);
      // P1 picks 4 cards
      if (await clickAction(pPage, 3)) {
          await pickCards(pPage, 4);
          await confirmAction(pPage); // Moves to phase 2 (Split)
          
          await wait(400);
          console.log(`${pLabel}: Splitting Groups (2+2)`);
          
          // Split Phase: Click 2 cards to form Group 1
          // Split Phase: Click 2 cards to form Group 1
          for (let i = 0; i < 2; i++) {
              // Target directly the cards in Group 2 (the ones we want to move to Group 1)
              // This avoids clicking cards already in Group 1 (which would toggle them back)
              // Selector: second .card-set (Group 2) -> .card
              const cardsInGroup2 = await pPage.$$('.competition-sets.split-mode .card-set:nth-child(2) .card');
              
              if (cardsInGroup2[0]) {
                  await cardsInGroup2[0].click();
                  await wait(200); 
              }
          }
          await wait(200);
          
          await confirmAction(pPage); // "Ofrecer Grupos"
          
          console.log(`${pLabel} offered Competition. Waiting for ${oLabel}...`);
          await wait(1500); // Wait for socket propagation
          
          // Opponent Chooses Group
          console.log(`${oLabel}: Choosing Group`);
          
          // Retry loop to wait for groups to appear
          for (let attempt = 0; attempt < 5; attempt++) {
               const sets = await oPage.$$('.resolver-sets .card-set');
               if (sets[0]) {
                   await sets[0].click(); 
                   console.log(`${oLabel} Clicked Group`);
                   await wait(500);
                   break;
               } else {
                   console.log(`${oLabel} waiting for groups...`);
                   await wait(1000);
               }
          }
      }
      await wait(1000);
  }

  // --- GAME LOOP ---

  async function playRound(roundNum) {
      console.log(`=== STARTING ROUND ${roundNum} ===`);
      
      // Turn 1: P1 Secret
      await doSecret('P1', page1);
      // Turn 2: P2 Secret
      await doSecret('P2', page2);
      
      // Turn 3: P1 Discard
      await doDiscard('P1', page1);
      // Turn 4: P2 Discard
      await doDiscard('P2', page2);
      
      // Turn 5: P1 Gift
      await doGift('P1', page1, 'P2', page2);
      // Turn 6: P2 Gift
      await doGift('P2', page2, 'P1', page1);
      
      // Turn 7: P1 Competition
      await doCompetition('P1', page1, 'P2', page2);
      // Turn 8: P2 Competition
      await doCompetition('P2', page2, 'P1', page1);
      
      console.log(`=== ROUND ${roundNum} FINISHED ===`);
  }

  // Dynamic Round Loop
  let round = 1;
  const MAX_ROUNDS = 4; // Safety limit
  
  while (round <= MAX_ROUNDS) {
      await playRound(round);
      
      // After a round, check if Game Over modal appeared?
      // Or just wait and see if "New Round" happens. 
      // The simplest way is to try to start actions. If game is over, buttons won't be clickable or won't exist.
      // But we need to wait for the reset.
      
      console.log('Waiting for Round Reset or Game Over...');
      await wait(3000);
      
      // Check if Game Over happened (optional check, or just blindly try next round)
      // If the game is over, the UI shows Game Over and actions are removed.
      // clickAction checks if button exists. If not, it logs and returns false.
      // So the script will just fail gracefully on subsequent rounds.
      
      round++;
  }

  console.log('--- Simulation Complete ---');

})();
