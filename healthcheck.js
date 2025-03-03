// healthcheck.js - Simple health check script for Docker
const http = require('http');
const fs = require('fs');

// Create a basic HTTP server for health checks
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    // Check if Discord client is connected
    if (global.healthStatus && global.healthStatus.ready) {
      res.statusCode = 200;
      res.end(JSON.stringify({ 
        status: 'healthy', 
        uptime: process.uptime(),
        discordConnected: true,
        lastPing: global.healthStatus.lastPing,
        databaseConnected: global.healthStatus.databaseConnected
      }));
    } else {
      res.statusCode = 503;
      res.end(JSON.stringify({ 
        status: 'unhealthy', 
        uptime: process.uptime(),
        discordConnected: false,
        lastPing: global.healthStatus?.lastPing || null,
        databaseConnected: global.healthStatus?.databaseConnected || false
      }));
    }
  } else {
    res.statusCode = 404;
    res.end('Not found');
  }
});

// Start the server on port 8080
server.listen(8080, () => {
  console.log('Health check server running on port 8080');
});

// Export for use in main bot file
module.exports = {
  updateStatus: (status) => {
    global.healthStatus = status;
  }
};