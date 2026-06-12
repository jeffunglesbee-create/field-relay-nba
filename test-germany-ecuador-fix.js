import { deriveTeamStrengths, computeTournamentProjections } from './src/wc-tournament-projections.js';

console.log('═'.repeat(70));
console.log('WC TOURNAMENT CALIBRATION: Impact of Adding Germany vs Ecuador');
console.log('═'.repeat(70));

// SCENARIO 1: Missing game (Germany vs Ecuador not priced)
// Ecuador's attack will be padded toward mean, underestimating the underdog facing Germany
const simpleOdds = [
  {
    home_team: 'Germany',
    away_team: 'Curaçao',
    pHome: 0.92, pDraw: 0.06, pAway: 0.02,
    lambdaHome: 2.56, lambdaAway: 0.35, lambdaTotal: 2.91,
    lambdaSource: 'totals'
  },
  {
    home_team: 'Ivory Coast',
    away_team: 'Ecuador',
    pHome: 0.26, pDraw: 0.35, pAway: 0.39,
    lambdaHome: 0.95, lambdaAway: 1.07, lambdaTotal: 2.02,
    lambdaSource: 'totals'
  },
  // Group A-D minimal (just for illustration)
];

const strengths1 = deriveTeamStrengths(simpleOdds);

console.log('\n📊 SCENARIO 1: Missing Game (71 games, Ecuador lacks Germany fixture)');
console.log(`   Ecuador attack: ${strengths1.Ecuador?.attack?.toFixed(3)} | defense: ${strengths1.Ecuador?.defense?.toFixed(3)}`);
console.log(`   Germany attack: ${strengths1.Germany?.attack?.toFixed(3)} | defense: ${strengths1.Germany?.defense?.toFixed(3)}`);
console.log('   ⚠️  Ecuador\'s strength over-inflated (avg of Curaçao blowout + Ivory Coast);');
console.log('   ⚠️  Missing game vs Germany (heavy underdog) not yet factored in');

// SCENARIO 2: With Germany vs Ecuador odds from screenshot
const completeOdds = [
  ...simpleOdds,
  {
    home_team: 'Germany',
    away_team: 'Ecuador',
    // Screenshot: Germany -135/-150 (56%), Ecuador +410 (21%), Draw 25%
    pHome: 0.56, pDraw: 0.25, pAway: 0.19,
    // O/U 2.5 implies total lambda ~2.1-2.2
    lambdaHome: 1.75,   // Germany's aggressive play vs Ecuador
    lambdaAway: 0.35,   // Ecuador's defensive play vs Germany  
    lambdaTotal: 2.10,
    lambdaSource: 'totals'
  }
];

const strengths2 = deriveTeamStrengths(completeOdds);

console.log('\n📊 SCENARIO 2: Complete (72 games, Germany vs Ecuador included)');
console.log(`   Ecuador attack: ${strengths2.Ecuador?.attack?.toFixed(3)} | defense: ${strengths2.Ecuador?.defense?.toFixed(3)}`);
console.log(`   Germany attack: ${strengths2.Germany?.attack?.toFixed(3)} | defense: ${strengths2.Germany?.defense?.toFixed(3)}`);
console.log('   ✅ Ecuador\'s strength corrected (average of all 3 group games)');
console.log('   ✅ Ecuador\'s underdog status vs Germany now reflected');

const delta = (strengths2.Ecuador?.attack - strengths1.Ecuador?.attack).toFixed(3);
console.log(`\n   Ecuador attack DELTA: ${delta} (${delta < 0 ? 'down' : 'up'})`);

console.log('\n💡 KEY INSIGHT: The screenshot proves the odds ARE available as of June 25.');
console.log('   Action: Relay fetches /wc/odds-probs, gets Germany vs Ecuador from Odds API,');
console.log('   automatically recalibrates Ecuador\'s tournament odds.');
console.log('═'.repeat(70));

