#!/usr/bin/env node

// wrap around webcrypto.getRandomValues() to use high-quality PRNG, when available
var getRandomValues = function (ab) {
  var err, i, j, octets

  if (!ab.BYTES_PER_ELEMENT) {
    err = new Error()
    err.name = 'TypeMisMatchError'
    throw err
  }
  if (ab.length > 65536) {
    err = new Error()
    err.name = 'QuotaExceededError'
    throw err
  }

  octets = require('crypto').randomBytes(ab.length * ab.BYTES_PER_ELEMENT)

  if (ab.BYTES_PER_ELEMENT === 1) ab.set(octets)
  else {
    for (i = j = 0; i < ab.length; i++, j += ab.BYTES_PER_ELEMENT) {
      ab[i] = { 2: (octets[j + 1] << 8) | (octets[j]),
                4: (octets[j + 3] << 24) | (octets[j + 2] << 16) | (octets[j + 1] << 8) | (octets[j]) }[ab.BYTES_PER_ELEMENT]
    }
  }

  return ab
}
var uuid = function () {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = getRandomValues(new Uint8Array(1))[0] % 16 | 0
    var v = c === 'x' ? r : (r & 0x3 | 0x8)

    return v.toString(16).toLowerCase()
  })
}
process.env.PERSONA = uuid()
process.env.SERVER = 'http://127.0.0.1:3001'
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
              ' [ -f file ] [ [ -s https://... ] | [-p personaID] ] [ -v ] ' + command)
  process.exit(1)
}

var server
var argv = process.argv.slice(2)
var configFile = process.env.CONFIGFILE || 'config.json'
var personaID = process.env.PERSONA
var verboseP = process.env.VERBOSE || false

while (argv.length > 0) {
  if (argv[0].indexOf('-') !== 0) break

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

  client = require('./index.js')(personaID, { server: server, verboseP: verboseP }, state, callback)
})

/*
 *
 * process the command
 *
 */

var run = function (delayTime) {
  var argv0

  if (delayTime > 0) return setTimeout(function () { client.sync(callback) }, delayTime)

  if (argv.length === 0) argv = [ 'get' ]
  argv0 = argv[0]
  argv = argv.slice(1)

  try {
    console.log(argv)
  } catch (err) {
    oops(argv0, err)
  }
}

var done = function (command) {
  if (typeof command !== 'string') command = ''
  else command += ' '
  if (verboseP) console.log(command + 'done.')

  process.exit(0)
}

var oops = function (s, err) {
  console.log(s + ': ' + err.toString())
  console.log(err.stack)
  process.exit(1)
}
