// This is a tiny web server. It sends the game files to your web browser.
// Start it with:  npm start
// Later, this is also where we will add multiplayer!

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 3000;

const PUBLIC_FOLDER = path.join(__dirname, 'public');
const THREE_FOLDER = path.join(__dirname, 'node_modules', 'three');

const FILE_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
};

const server = http.createServer((request, response) => {
  let url = decodeURIComponent(request.url.split('?')[0]);
  if (url === '/') url = '/index.html';

  // Files starting with /three/ come from the 3D library, everything else from "public"
  let baseFolder = PUBLIC_FOLDER;
  if (url.startsWith('/three/')) {
    baseFolder = THREE_FOLDER;
    url = url.slice('/three'.length);
  }

  const file = path.join(baseFolder, url);

  // Safety check: only send files that are inside the right folder
  if (!file.startsWith(baseFolder + path.sep)) {
    response.writeHead(403);
    response.end('Not allowed');
    return;
  }

  fs.readFile(file, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    const type = FILE_TYPES[path.extname(file)] || 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': type });
    response.end(data);
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ✈️  Skys is running!');
  console.log('');
  console.log(`  On this computer, open:   http://localhost:${PORT}`);
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const a of addresses) {
      if (a.family === 'IPv4' && !a.internal) {
        console.log(`  On another computer:      http://${a.address}:${PORT}`);
      }
    }
  }
  console.log('');
  console.log('  Press Ctrl+C to stop the server.');
  console.log('');
});
