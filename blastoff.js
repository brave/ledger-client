#!/usr/bin/env node

process.env.PERSONA = require('node-uuid').v4()
process.env.SERVER = 'http://127.0.0.1:3001'
process.env.DEBUG = true
process.env.VERBOSE = true

var fs = require('fs')
var path = require('path')
var url = require('url')

/*
 *
 * parse the command arguments
 *
 */

var usage = function (command) {
  if (typeof command !== 'string') command = 'get|put|rm [ args... ]'
  console.log('usage: node ' + path.basename(process.argv[1]) +
              ' [ -d ] [ -f file | -p personaID] [ -s https://... ] [ -v ] ' + command)
  process.exit(1)
}

var server
var argv = process.argv.slice(2)
var configFile = process.env.CONFIGFILE || 'config.json'
var debugP = process.env.DEBUG || false
var personaID = process.env.PERSONA
var verboseP = process.env.VERBOSE || false

while (argv.length > 0) {
  if (argv[0].indexOf('-') !== 0) break

  if (argv[0] === '-d') {
    debugP = true
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
  else if (argv[0] === '-p') personaID = argv[1]
  else usage()

  argv = argv.slice(2)
}
if (!server) server = process.env.SERVER || 'https://ledger-staging.brave.com'
if (server.indexOf('http') !== 0) server = 'https://' + server
server = url.parse(server)

/*
 *
 * create/recover state
 *
 */

var client

var callback = function (err, result, delayTime) {
  if (err) oops('client', err)
  if (verboseP) console.log('callback delayTime=' + delayTime)

  if (!result) return run(delayTime)

  fs.writeFile(configFile, JSON.stringify(result, null, 2), { encoding: 'utf8', mode: parseInt('644', 8) }, function (err) {
    if (err) oops(configFile, err)

    run(delayTime)
  })
}

fs.readFile(personaID ? '/dev/null' : configFile, { encoding: 'utf8' }, function (err, data) {
  var state = err ? null : data ? JSON.parse(data) : {}

  client = require('./index.js')(personaID, { server: server, debugP: debugP, verboseP: verboseP }, state, callback)
})

/*
 *
 * process the command
 *
 */

var reconcileP = false

var run = function (delayTime) {
  var report = [ { site: 'wsj.com', weight: 100 } ]

  if (delayTime > 0) return setTimeout(function () { client.sync(callback) }, delayTime)

  if (!client.readyToReconcile()) return client.reconcile(report, callback)
  if (reconcileP) return console.log('already reconciling.')

  reconcileP = true
  client.reconcile(report, callback)
}

var oops = function (s, err) {
  console.log(s + ': ' + err.toString())
  console.log(err.stack)
  process.exit(1)
}
