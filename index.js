var anonize = require('node-anonize2-relic')
var crypto = require('crypto')
var http = require('http')
var https = require('https')
var Joi = require('joi')
var underscore = require('underscore')
var url = require('url')

var Client = function (personaId, options, state, callback) {
  if (!(this instanceof Client)) return new Client(personaId, options, state, callback)

  var self = this

  self.options = underscore.defaults(options || {}, { server: 'https://ledger.brave.com', debugP: false, verboseP: false })
  self.state = underscore.defaults(state || {}, { personaId: personaId })

  return self.sync(callback)
}

Client.prototype.sync = function (callback) {
  var self = this

  var now

  if (typeof callback !== 'function') throw new Error('missing callback parameter')

  if (self.state.delayStamp) {
    now = underscore.now()

    if (self.state.delayStamp > now) return callback(null, null, self.state.delayStamp - now)
    delete self.state.delayStamp
  }

  if (!self.credentials) self.credentials = {}

  if (!self.state.persona) return self.registerPersona(callback)
  self.credentials.persona = new anonize.Credential(self.state.persona)

  if (!self.state.properties) {
    if (!self.state.prepareWallet) return self.prepareWallet(callback)
    return self.commitWallet(callback)
  }

  if (!self.state.wallet) return self.registerWallet(callback)
  self.credentials.wallet = new anonize.Credential(self.state.wallet)

  if (self.state.pollTransaction) return self.prepareTransaction(callback)
  if (self.state.prepareTransaction) return self.submitTransaction(callback)
}

var propertyList = [ 'setting', 'fee' ]

Client.prototype.get = function () {
  return underscore.pick(this.state.properties, 'setting', 'fee')
}

Client.prototype.set = function (properties, callback) {
  var self = this

  var modifyP

  if (typeof callback !== 'function') throw new Error('missing callback parameter')

  modifyP = false
  propertyList.forEach(function (property) {
    var value = properties[property]

    if ((typeof value !== 'undefined') && (value === self.state.properties[property])) {
      modifyP = true

      self.state.properties[property] = value
    }
  })

  if (modifyP) callback(null, self.state)
}

Client.prototype.walletAddress = function () {
  return this.state.properties && this.state.properties.wallet && this.state.properties.wallet.address
}

Client.prototype.walletProperties = function (callback) {
  var self = this

  var path

  if (typeof callback !== 'function') throw new Error('missing callback parameter')
  if ((!self.state.properties) || (!self.state.properties.wallet)) {
    throw new Error('Ledger client initialization incomplete.')
  }

  path = '/v1/wallet/' + self.state.properties.wallet.paymentId
  self.roundtrip({ path: path, method: 'GET' }, function (err, response, body) {
    if (err) return callback(err)

    callback(null, body)
  })
}

Client.prototype.verifyURL = function () {
  if ((!this.state.properties) || (!this.state.properties.wallet)) {
    throw new Error('Ledger client initialization incomplete.')
  }

  return url.format(underscore.pick(this.options.server, 'protocol', 'hostname', 'port')) +
           '/v1/oauth/bitgo/' + this.state.properties.wallet.paymentId
}

Client.prototype.readyToReconcile = function () {
  var now = underscore.now()

  if (!this.state.reconcileStamp) throw new Error('Ledger client initialization incomplete.')
  return (this.state.reconcileStamp >= now)
}

Client.prototype.reconcile = function (report, callback) {
  var self = this

  var delayTime, path, result, schema

  if (!callback) {
    callback = report
    report = null
  }
  if (typeof callback !== 'function') throw new Error('missing callback parameter')
  if (!this.state.reconcileStamp) throw new Error('Ledger client initialization incomplete.')
  if (self.state.properties.setting === 'adFree') {
    if (!report) throw new Error('missing report parameter')

    schema = Joi.array().items(Joi.object().keys(
               { site: Joi.string().required(), weight: Joi.number().positive().required() }
             )).min(1)

    result = Joi.validate(report, schema)
    if (result.error) throw new Error(result.error)
  }

  delayTime = underscore.now() - this.state.reconcileStamp
  if (delayTime > 0) return callback(null, null, delayTime)

  if (self.state.properties.setting !== 'adFree') {
    throw new Error('setting not (yet) supported: ' + self.state.properties.setting)
  }

  path = '/v1/wallet/' + self.state.properties.wallet.paymentId
  self.roundtrip({ path: path, method: 'GET' }, function (err, response, body) {
    var payload

    if (err) return callback(err)

    if (body.balance < self.state.properties.fee) return callback(new Error('insufficient funds'))

    path = '/v1/wallet/' + self.state.properties.wallet.paymentId
    payload = { amount: self.state.properties.fee }
    self.roundtrip({ path: path, method: 'PUT', payload: payload }, function (err, response, body) {
      if (err) return callback(err)

      self.state.pollTransaction = underscore.defaults(body, { report: report, stamp: self.state.reconcileStamp,
                                                               server: self.options.server })
      self.state.reconcileStamp = underscore.now() + self.backOff(30)

      callback(null, self.state, 100)
    })
  })
}

/*
 *
 * internal functions
 *
 */

Client.prototype.registerPersona = function (callback) {
  var self = this

  var path

  path = '/v1/registrar/persona/publickey'
  self.roundtrip({ path: path, method: 'GET' }, function (err, response, body) {
    var credential, payload, persona

    if (err) return callback(err)

    persona = underscore.defaults(body, { server: self.options.server })

    credential = new anonize.Credential(self.state.personaId, persona.registrarVK)

    path = '/v1/registrar/persona/' + self.state.personaId
    try { payload = { proof: credential.request() } } catch (ex) { return callback(ex) }
    self.roundtrip({ path: path, method: 'POST', payload: payload }, function (err, response, body) {
      if (err) return callback(err)

      try { credential.finalize(body.verification) } catch (ex) { return callback(ex) }
      self.state.persona = JSON.stringify(credential)

      callback(null, self.state, 100)
    })
  })
}

Client.prototype.prepareWallet = function (callback) {
  var self = this

  var path

  path = '/v1/surveyor/wallet/current/' + self.state.personaId
  self.roundtrip({ path: path, method: 'GET' }, function (err, response, body) {
    var delayTime, now

    if (err) return callback(err)

    self.state.prepareWallet = underscore.defaults(body, { server: self.options.server })

    now = underscore.now()
    delayTime = self.backOff(randomInt(0, 30))
    self.state.delayStamp = now + delayTime

    callback(null, self.state, delayTime)
  })
}

Client.prototype.commitWallet = function (callback) {
  var self = this

  var path, payload
  var surveyor = new anonize.Surveyor(self.state.prepareWallet)

  path = '/v1/surveyor/wallet/' + encodeURIComponent(surveyor.parameters.surveyorId)
  try { payload = { proof: self.credentials.persona.submit(surveyor) } } catch (ex) { return callback(ex) }
  self.roundtrip({ path: path, method: 'PUT', payload: payload }, function (err, response, body) {
    if (err) return callback(err)

// TBD: setting should be adReplacement, and the initial fee should come from a web service...
//      e.g., https://blockchain.info/tobtc?currency=USD&value=4.95
//         or https://api.bitcoinaverage.com/ticker/global/USD/last
    self.state.properties = underscore.extend({ setting: 'adFree', fee: 0.0118 }, underscore.pick(body, 'wallet'))
    delete self.state.prepareWallet

    callback(null, self.state, 100)
  })
}

Client.prototype.registerWallet = function (callback) {
  var self = this

  var path

  path = '/v1/registrar/wallet/publickey'
  self.roundtrip({ path: path, method: 'GET' }, function (err, response, body) {
    var credential, payload, wallet

    if (err) return callback(err)

    wallet = underscore.defaults(body, { server: self.options.server })

    credential = new anonize.Credential(self.state.properties.wallet.paymentId, wallet.registrarVK)

    path = '/v1/registrar/wallet/' + self.state.properties.wallet.paymentId
    try { payload = { proof: credential.request() } } catch (ex) { return callback(ex) }
    self.roundtrip({ path: path, method: 'POST', payload: payload }, function (err, response, body) {
      if (err) return callback(err)

      try { credential.finalize(body.verification) } catch (ex) { return callback(ex) }
      self.state.wallet = JSON.stringify(credential)
      self.state.bootStamp = underscore.now()
      self.state.reconcileStamp = self.state.bootStamp + self.backOff(30)

      callback(null, self.state)
    })
  })
}

Client.prototype.prepareTransaction = function (callback) {
  var self = this

  var path

  path = '/v1/wallet/' + self.state.properties.wallet.paymentId
  self.roundtrip({ path: path, method: 'GET' }, function (err, response, body) {
    if (err) return callback(err)

    if ((!body.lastPaymentStamp) || (body.lastPaymentStamp < self.state.pollTransaction.stamp)) {
      return callback(null, null, randomInt(0, 10 * 60 * 1000))
    }

    path = '/v1/surveyor/browsing/current/' + self.state.properties.wallet.paymentId
    self.roundtrip({ path: path, method: 'GET' }, function (err, response, body) {
      var delayTime, now

      if (err) return callback(err)

      self.state.prepareTransaction = underscore.defaults(body, { report: self.state.pollTransaction.report,
                                                                  server: self.options.server })
      delete self.state.pollTransaction

      now = underscore.now()
      delayTime = self.backOff(randomInt(0, 1))
      self.state.delayStamp = now + delayTime

      callback(null, self.state, delayTime)
    })
  })
}

Client.prototype.submitTransaction = function (callback) {
  var self = this

  var path, payload
  var surveyor = new anonize.Surveyor(self.state.prepareTransaction)

  path = '/v1/surveyor/browsing/' + encodeURIComponent(surveyor.parameters.surveyorId)
  try {
    payload = { proof: self.credentials.wallet.submit(surveyor, { report: self.state.prepareTransaction.report }) }
  } catch (ex) { return callback(ex) }
  self.roundtrip({ path: path, method: 'PUT', payload: payload }, function (err, response, body) {
    if (err) return callback(err)

    delete self.state.prepareTransaction

    callback(null, self.state)
  })
}

Client.prototype.backOff = function (days) {
  return (this.options.debugP ? 1 : days * 86400) * 1000
}

// roundtrip to the ledger
Client.prototype.roundtrip = function (options, callback) {
  var self = this

  var request
  var client = self.options.server.protocol === 'https:' ? https : http

  options = underscore.extend(underscore.pick(self.options.server, 'protocol', 'hostname', 'port'), options)

  request = client.request(underscore.omit(options, 'payload'), function (response) {
    var body = ''

    response.on('data', function (chunk) {
      body += chunk.toString()
    }).on('end', function () {
      var payload

      if (self.options.verboseP) {
        console.log('>>> HTTP/' + response.httpVersionMajor + '.' + response.httpVersionMinor + ' ' + response.statusCode +
                   ' ' + (response.statusMessage || ''))
      }
      if (Math.floor(response.statusCode / 100) !== 2) return callback(new Error('HTTP response ' + response.statusCode))

      try {
        payload = (response.statusCode !== 204) ? JSON.parse(body) : null
      } catch (err) {
        return callback(err)
      }
      if (self.options.verboseP) console.log('>>> ' + JSON.stringify(payload, null, 2).split('\n').join('\n>>> '))

      try {
        callback(null, response, payload)
      } catch (err0) {
        if (self.options.verboseP) console.log('callback: ' + err0.toString())
      }
    }).setEncoding('utf8')
  }).on('error', function (err) {
    callback(err)
  })
  if (options.payload) request.write(JSON.stringify(options.payload))
  request.end()

  if (!self.options.verboseP) return

  console.log('<<< ' + options.method + ' ' + options.path)
  if (options.payload) console.log('<<< ' + JSON.stringify(options.payload, null, 2).split('\n').join('\n<<< '))
}

/*
 *
 * utility functions
 *
 */

// based on https://github.com/EFForg/OpenWireless/pull/195/files#diff-8cddc026f79ea9a8ce95eb6112cc3a50R57

var randomInt = function (min, max) {
  var rval = 0
  var range = max - min

  var bits_needed = Math.ceil(Math.log2(range))
  if (bits_needed > 53) throw new Error('We cannot generate numbers larger than 53 bits.')
  var bytes_needed = Math.ceil(bits_needed / 8)
  var mask = Math.pow(2, bits_needed) - 1
  // 7776 -> (2^13 = 8192) -1 == 8191 or 0x00001111 11111111

  // Create byte array and fill with N random numbers
  var byteArray = crypto.randomBytes(bytes_needed)

  var p = (bytes_needed - 1) * 8
  for (var i = 0; i < bytes_needed; i++) {
    rval += byteArray[i] * Math.pow(2, p)
    p -= 8
  }

  // Use & to apply the mask and reduce the number of recursive lookups
  rval = rval & mask

  if (rval >= range) {
    // Integer out of acceptable range
    return randomInt(min, max)
  }
  // Return an integer that falls within the range
  return min + rval
}

module.exports = Client
