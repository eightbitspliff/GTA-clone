import { Game } from './core/Game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Game(canvas);
game.start();

// Expose for debugging in the browser console
(window as unknown as { game: Game }).game = game;
