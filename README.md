# ✈️ Skys

A little 3D airplane game. Fly through a big city (downtown towers, parks, houses, factories) and pop the balloons!

## How to start the game

1. Open the **Terminal** app and go to this folder.
2. Type `npm start` and press Enter.
3. Open your web browser and go to **http://localhost:3000**
4. Click the screen to start flying!

To stop the game server, go back to the Terminal and press **Ctrl + C**.

## Controls

| Key       | What it does        |
|-----------|---------------------|
| W         | Climb up            |
| S         | Dive down           |
| A         | Turn left           |
| D         | Turn right          |
| Shift     | Go faster (boost!)  |
| Space     | Shoot               |
| B         | Drop a bomb 💣      |
| C         | Switch camera       |
| M         | Music on / off      |
| F         | Full screen         |

## The files

- `public/game.js`: the game itself (flying, shooting, bombs, balloons, camera)
- `public/world.js`: the sky, city, buildings, parks, mountains and clouds
- `public/plane.js`: how the airplane and the bombs are built
- `public/effects.js`: explosions, fire, smoke and flying pieces
- `public/sounds.js`: all the sounds, made with code
- `public/index.html`: the web page that holds the game
- `server.js`: a tiny web server that sends the game to the browser

💡 **Tip:** at the top of `public/game.js` there is a `SETTINGS` list.
Try changing the numbers (like `boostSpeed` or `planeColor`), save, and reload the page!

## Coming next

- 👨‍👦 Multiplayer: play with Dad on the home network!
