// Test: verify all 72 WC games are now in Odds API, including Germany vs Ecuador

import fetch from 'node-fetch';

async function testWCOdds() {
  const key = process.env.ODDS_API_KEY || '';
  if (!key) {
    console.error('ODDS_API_KEY not set');
    process.exit(1);
  }

  const url = `https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup/odds?apiKey=${key}&markets=h2h,totals&regions=us&oddsFormat=decimal`;
  
  console.log('Fetching WC odds from Odds API...\n');
  
  try {
    const resp = await fetch(url);
    const data = await resp.json();
    
    if (!data.ok) {
      console.error('Odds API error:', data);
      process.exit(1);
    }

    const games = data.games || [];
    console.log(`✅ Total games in response: ${games.length}`);
    
    // Find Germany vs Ecuador
    const germanyEcuador = games.find(g => 
      (g.home_team === 'Germany' && g.away_team === 'Ecuador') ||
      (g.home_team === 'Ecuador' && g.away_team === 'Germany')
    );
    
    if (germanyEcuador) {
      console.log('\n✅ Germany vs Ecuador FOUND:');
      console.log(`   Home: ${germanyEcuador.home_team}`);
      console.log(`   Away: ${germanyEcuador.away_team}`);
      console.log(`   Time: ${germanyEcuador.commence_time}`);
      
      // Check for h2h odds
      let h2hCount = 0;
      let totalsCount = 0;
      for (const bm of germanyEcuador.bookmakers || []) {
        if (bm.markets?.find(m => m.key === 'h2h')) h2hCount++;
        if (bm.markets?.find(m => m.key === 'totals')) totalsCount++;
      }
      console.log(`   Bookmakers with h2h: ${h2hCount}`);
      console.log(`   Bookmakers with totals: ${totalsCount}`);
    } else {
      console.log('\n❌ Germany vs Ecuador NOT FOUND');
    }

    // Group E summary
    const groupE = games.filter(g => {
      const teams = [g.home_team, g.away_team];
      const groupETeams = ['Germany', 'Curaçao', 'Ecuador', 'Ivory Coast'];
      return teams.some(t => groupETeams.includes(t));
    });

    console.log(`\n📊 Group E games in Odds API: ${groupE.length}/4`);
    groupE.forEach(g => {
      console.log(`   ${g.home_team} vs ${g.away_team}`);
    });

    console.log(`\n📊 Coverage: ${games.length}/72 group stage games`);
    console.log(`   Status: ${games.length === 72 ? '✅ COMPLETE' : '⚠️  INCOMPLETE'}`);
    
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

testWCOdds();
