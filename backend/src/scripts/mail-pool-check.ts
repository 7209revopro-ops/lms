/**
 * The mailbox transports keep one connection open (2026-11-18: Gmail's "454 4.7.0 Too many login attempts" after a
 * sign-in for every email) — against a stand-in SMTP server in this process: five emails, one sign-in (and one for
 * the mailbox check at start-up; before, six). With the
 * outbox off, so the emails go straight out; no database.
 *   cd backend && DOTENV_CONFIG_PATH=/nonexistent bun --no-env-file src/scripts/mail-pool-check.ts
 */
const stub = { logins: 0, messages: 0 };
const server = Bun.listen<{ buf: string; data: boolean }>({
  hostname: '127.0.0.1', port: 0,
  socket: {
    open(s) { s.data = { buf: '', data: false }; s.write('220 stub ESMTP\r\n') },
    data(s, chunk) {
      s.data.buf += chunk.toString()
      let i: number
      while ((i = s.data.buf.indexOf('\r\n')) >= 0) {
        const line = s.data.buf.slice(0, i)
        s.data.buf = s.data.buf.slice(i + 2)
        if (s.data.data) { if (line === '.') { s.data.data = false; stub.messages++; s.write(`250 2.0.0 OK id-${stub.messages}\r\n`) } continue }
        const cmd = line.slice(0, 4).toUpperCase()
        if (cmd === 'EHLO' || cmd === 'HELO') s.write('250-stub\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n')
        else if (cmd === 'AUTH') { stub.logins++; s.write('235 2.7.0 Accepted\r\n') }
        else if (cmd === 'MAIL') s.write('250 2.1.0 OK\r\n')
        else if (cmd === 'RCPT') s.write('250 2.1.5 OK\r\n')
        else if (cmd === 'DATA') { s.data.data = true; s.write('354 Go ahead\r\n') }
        else if (cmd === 'RSET' || cmd === 'NOOP') s.write('250 2.0.0 OK\r\n')
        else if (cmd === 'QUIT') { s.write('221 2.0.0 Bye\r\n'); s.end() }
        else s.write('502 5.5.1 Unrecognized command\r\n')
      }
    },
  },
})
Object.assign(process.env, {
  NODE_ENV: 'development', EMAIL_OUTBOX: 'off', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(server.port), SMTP_SECURE: 'false',
  SMTP_USER: 'mailer@e2e.local', SMTP_PASS: 'x', EMAIL_FROM: 'LMS <mailer@e2e.local>', SMTP_BACKUP_HOST: '', SMTP_BACKUP_USER: '', SMTP_BACKUP_PASS: '',
})
const { sendLoginCode } = await import('@/services/email.service.ts')
for (let k = 1; k <= 5; k++) await sendLoginCode(`s${k}@e2e.local`, 'Student', String(100000 + k))
await Bun.sleep(500)
// One sign-in for the mailbox check at start-up (its own connection), one for all five emails — before: one each.
const ok = stub.messages === 5 && stub.logins === 2
console.log(`${ok ? '\x1b[32m✓' : '\x1b[31m✗'} five emails, ${stub.logins} sign-in(s) (one is the start-up check), ${stub.messages} sent\x1b[0m`)
server.stop(true)
process.exit(ok ? 0 : 1)
