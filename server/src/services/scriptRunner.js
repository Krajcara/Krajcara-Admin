'use strict';
const { Client } = require('ssh2');
const { decrypt } = require('./encryptionService');
const db = require('../db/database');

// Run a script on one server, streaming output via callback
function runOnServer(server, scriptContent, onData, onDone) {
  return new Promise((resolve) => {
    const conn   = new Client();
    const result = { stdout: '', stderr: '', exitCode: null, error: null };

    const sshOpts = {
      host:          server.ip_address,
      port:          server.ssh_port || 22,
      username:      server.ssh_user,
      readyTimeout:  15000,
    };

    if (server.ssh_key) {
      sshOpts.privateKey = decrypt(server.ssh_key);
      if (server.ssh_passphrase) sshOpts.passphrase = decrypt(server.ssh_passphrase);
    } else if (server.ssh_password) {
      sshOpts.password = decrypt(server.ssh_password);
    }

    conn.on('ready', () => {
      // Wrap in bash -s for stdin, or direct exec for simple
      conn.exec('bash -s', { pty: false }, (err, stream) => {
        if (err) {
          result.error = err.message;
          onData?.('error', `Connection error: ${err.message}\n`);
          onDone?.(result);
          conn.end();
          return resolve(result);
        }

        stream.stdin.write(scriptContent + '\n');
        stream.stdin.end();

        stream.on('data', data => {
          const s = data.toString();
          result.stdout += s;
          onData?.('stdout', s);
        });

        stream.stderr.on('data', data => {
          const s = data.toString();
          result.stderr += s;
          onData?.('stderr', s);
        });

        stream.on('close', code => {
          result.exitCode = code;
          onDone?.(result);
          conn.end();
          resolve(result);
        });
      });
    });

    conn.on('error', err => {
      result.error = err.message;
      onData?.('error', `SSH error: ${err.message}\n`);
      onDone?.(result);
      resolve(result);
    });

    conn.connect(sshOpts);
  });
}

// Run script on multiple servers, emit live output via Socket.io
async function runScript({ executionId, servers, scriptContent, scriptName, io }) {
  const results = {};

  // Mark all servers as running
  for (const srv of servers) {
    results[srv.id] = { status: 'running', output: '', exitCode: null, error: null };
    io?.to(`exec_${executionId}`).emit('script:output', {
      executionId, serverId: srv.id, serverName: srv.name,
      type: 'info', data: `Connecting to ${srv.name} (${srv.ip_address})...\n`
    });
  }

  // Run all servers in parallel
  await Promise.all(servers.map(async srv => {
    try {
      await runOnServer(
        srv, scriptContent,
        (type, data) => {
          results[srv.id].output += data;
          io?.to(`exec_${executionId}`).emit('script:output', {
            executionId, serverId: srv.id, serverName: srv.name, type, data
          });
        },
        (result) => {
          results[srv.id] = {
            status:   result.error ? 'error' : result.exitCode === 0 ? 'success' : 'failed',
            output:   result.stdout + result.stderr,
            exitCode: result.exitCode,
            error:    result.error,
          };
          io?.to(`exec_${executionId}`).emit('script:done', {
            executionId, serverId: srv.id, serverName: srv.name,
            status: results[srv.id].status, exitCode: result.exitCode,
          });
        }
      );
    } catch (e) {
      results[srv.id] = { status: 'error', output: '', exitCode: null, error: e.message };
      io?.to(`exec_${executionId}`).emit('script:done', {
        executionId, serverId: srv.id, serverName: srv.name, status: 'error', error: e.message,
      });
    }
  }));

  // Save execution result to DB
  try {
    db.prepare(`
      UPDATE script_executions SET status='done', result=?, finished_at=datetime('now') WHERE id=?
    `).run(JSON.stringify(results), executionId);
  } catch {}

  io?.to(`exec_${executionId}`).emit('script:all_done', { executionId, results });
  return results;
}

module.exports = { runScript, runOnServer };
