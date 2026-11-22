// 🌐 NETWORK: talks to the server, which passes messages to the other players.
// It uses a "WebSocket": a phone line that stays open between the browser and the server.

export class Network {
  constructor() {
    this.id = null;
    this.onMessage = () => {};
    this.onClose = () => {};
  }

  // Connect, and wait for the server to say "welcome"
  connect() {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://${location.host}`);
      this.socket = socket;
      socket.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'welcome') {
          this.id = msg.id;
          resolve(msg);
        } else {
          this.onMessage(msg);
        }
      };
      socket.onerror = () => reject(new Error('Could not connect'));
      socket.onclose = () => this.onClose();
    });
  }

  send(message) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }
}
