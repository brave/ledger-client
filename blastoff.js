#!/usr/bin/env node

var fs = require('fs')
var path = require('path')
var url = require('url')

/*
 *
 * parse the command arguments
 *
 */

var usage = function () {
  console.log('usage: node ' + path.basename(process.argv[1]) +
              ' [ -d ] [ -f file | -p personaID] [ -l ] [ -s https://... ] [ -v ]')
  process.exit(1)
}

var options, server
var argv = process.argv.slice(2)
var configFile = process.env.CONFIGFILE
var personaID = process.env.PERSONA
var debugP = process.env.DEBUG || false
var loggingP = process.env.LOGGING || false
var verboseP = process.env.VERBOSE || false
var walletFile = process.env.WALLETFILE

while (argv.length > 0) {
  if (argv[0].indexOf('-') !== 0) break

  if (argv[0] === '-d') {
    debugP = true
    argv = argv.slice(1)
    continue
  }
  if (argv[0] === '-l') {
    loggingP = true
    argv = argv.slice(1)
    continue
  }
  if (argv[0] === '-v') {
    verboseP = true
    argv = argv.slice(1)
    continue
  }

  if (argv.length === 1) usage()

  if (argv[0] === '-f') configFile = argv[1]
  else if (argv[0] === '-s') server = argv[1]
  else if (argv[0] === '-p') personaID = argv[1].toLowerCase()
  else if (argv[0] === '-w') walletFile = argv[1]
  else usage()

  argv = argv.slice(2)
}
if ((!configFile) && (!personaID)) usage()
if (!configFile) configFile = 'config.json'

if (!server) server = process.env.SERVER || 'https://ledger-staging.brave.com'
if (server.indexOf('http') !== 0) server = 'https://' + server
server = url.parse(server)

options = { server: server, debugP: debugP, loggingP: loggingP, verboseP: verboseP }
if (walletFile) options.wallet = JSON.parse(fs.readFileSync(walletFile))

/*
 *
 * create/recover state
 *
 */

var client

var callback = function (err, result, delayTime) {
  var entries = client.report()

  if (err) oops('client', err)
  if (verboseP) console.log('callback delayTime=' + delayTime)

  if (!result) return run(delayTime)

  if (entries) entries.forEach(function (entry) { console.log('*** ' + JSON.stringify(entry)) })

  if (result.thisPayment) {
    console.log('\nplease click here for payment: ' + result.thisPayment.paymentURL + '\n')
  }
  fs.writeFile(configFile, JSON.stringify(result, null, 2), { encoding: 'utf8', mode: parseInt('644', 8) }, function (err) {
    if (err) oops(configFile, err)

    run(delayTime)
  })
}

fs.readFile(personaID ? '/dev/null' : configFile, { encoding: 'utf8' }, function (err, data) {
  var state = err ? null : data ? JSON.parse(data) : {}

  client = require('./index.js')(personaID, options, state, callback)
})

/*
 *
 * process the command
 *
 */

var reconcileP = false

var run = function (delayTime) {
  var report = [ { site: 'wsj.com', weight: 100 } ]

  if (delayTime > 0) return setTimeout(function () { if (client.sync(callback)) return run(0) }, delayTime)

  if (!client.isReadyToReconcile()) return client.reconcile(report, callback)
  if (reconcileP) return console.log('already reconciling.')

  reconcileP = true
  client.reconcile(report, callback)
}

var oops = function (s, err) {
  console.log(s + ': ' + err.toString())
  console.log(err.stack)
  process.exit(1)
}
