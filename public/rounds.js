// 🏆 ROUNDS: the timer at the top, the winner screen with confetti, and "3, 2, 1, GO!"
// The server decides when rounds start and end. This file just shows it on the screen.

const timer = document.getElementById('timer');
const winner = document.getElementById('winner');
const winnerTitle = document.getElementById('winnertitle');
const podium = document.getElementById('podium');
const countdown = document.getElementById('countdown');

const MEDALS = ['🥇', '🥈', '🥉'];
const hex = (color) => '#' + color.toString(16).padStart(6, '0');
const safe = (text) => String(text).replace(/[<>&"]/g, '');

export class Rounds {
  constructor(sounds) {
    this.sounds = sounds;
    this.phase = 'waiting';
    this.endsAt = 0;
    this.lastSecond = null;
  }

  // The server tells us the round's phase and how much time is left
  set(round) {
    this.phase = round.phase;
    this.endsAt = performance.now() + round.remaining;
  }

  get playing() {
    return this.phase === 'playing';
  }

  update() {
    const secondsLeft = Math.max(0, Math.ceil((this.endsAt - performance.now()) / 1000));
    if (this.phase === 'playing') {
      const minutes = Math.floor(secondsLeft / 60);
      timer.textContent = `⏱ ${minutes}:${String(secondsLeft % 60).padStart(2, '0')}`;
      timer.classList.toggle('hurry', secondsLeft <= 10);
      // Beep in the last 10 seconds
      if (secondsLeft <= 10 && secondsLeft > 0 && secondsLeft !== this.lastSecond) this.sounds.beep(880, 0.12, 0.2);
    } else if (this.phase === 'ended') {
      timer.textContent = '🏁 Round over!';
      timer.classList.remove('hurry');
      // 3, 2, 1 at the end of the winner screen
      const text = secondsLeft <= 3 && secondsLeft > 0 ? String(secondsLeft) : '';
      if (countdown.textContent !== text) {
        countdown.textContent = text;
        if (text) this.sounds.beep(660, 0.25, 0.3);
      }
    } else {
      timer.textContent = '';
    }
    this.lastSecond = secondsLeft;
  }

  showWinner(ranking, myId) {
    const best = ranking[0];
    const tie = ranking.length > 1 && ranking[1].score === best.score;
    if (!best) winnerTitle.textContent = 'Round over!';
    else if (tie) winnerTitle.textContent = "🤝 It's a tie!";
    else if (best.id === myId) winnerTitle.textContent = '🎉 You win! 🎉';
    else winnerTitle.textContent = `${safe(best.name)} wins!`;

    podium.innerHTML = ranking
      .map((p, i) => `${MEDALS[i] || '🎖️'} <span style="color:${hex(p.color)}">${safe(p.name)}</span>: ${p.score} points`)
      .join('<br>');
    countdown.textContent = '';
    winner.hidden = false;
    this.sounds.fanfare();

    // Confetti!
    for (let i = 0; i < 90; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti';
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.background = `hsl(${Math.random() * 360}, 90%, 60%)`;
      piece.style.animationDuration = `${2.5 + Math.random() * 3}s`;
      piece.style.animationDelay = `${Math.random() * 2}s`;
      winner.append(piece);
    }
  }

  hideWinner() {
    winner.hidden = true;
    for (const piece of winner.querySelectorAll('.confetti')) piece.remove();
  }
}
