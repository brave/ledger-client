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

  self.options = underscore.defaults(options || {}
                                   , { server: 'https://ledger.brave.com', debugP: false, loggingP: false, verboseP: false })
  self.state = underscore.defaults(state || {}, { personaId: personaId })
  self.logging = []

  return self.sync(callback)
}

Client.prototype.sync = function (callback) {
  var self = this

  var delayTime

  if (typeof callback !== 'function') throw new Error('missing callback parameter')

  if (self.state.delayStamp) {
    delayTime = this.state.delayStamp - underscore.now()
    if (delayTime > 0) {
      self._log('sync', { delayTime: delayTime })
      return callback(null, null, delayTime)
    }
    delete self.state.delayStamp
  }

  if (!self.credentials) self.credentials = {}

  if (!self.state.persona) return self._registerPersona(callback)
  self.credentials.persona = new anonize.Credential(self.state.persona)

  if (!self.state.properties) {
    if (!self.state.prepareWallet) return self._prepareWallet(callback)
    return self._commitWallet(callback)
  }

  if (!self.state.wallet) return self._registerWallet(callback)
  self.credentials.wallet = new anonize.Credential(self.state.wallet)

  if (self.state.pollTransaction) return self._prepareTransaction(callback)
  if (self.state.prepareTransaction) return self._submitTransaction(callback)

  self._log('sync', { result: true })
  return true
}

var propertyList = [ 'setting', 'fee' ]

Client.prototype.getBraveryProperties = function () {
  this._log('getBraveryProperties')

  return underscore.pick(this.state.properties, 'setting', 'fee')
}

Client.prototype.setBraveryProperties = function (properties, callback) {
  var self = this

  var modifyP

  if (typeof callback !== 'function') throw new Error('missing callback parameter')

  self._log('setBraveryProperties', { keys: underscore.keys(properties) })

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

Client.prototype.getWalletAddress = function () {
  this._log('getWalletAddress')

  return this.state.properties && this.state.properties.wallet && this.state.properties.wallet.address
}

Client.prototype.getWalletProperties = function (callback) {
  var self = this

  var errP, path

  if (typeof callback !== 'function') throw new Error('missing callback parameter')

  errP = (!self.state.properties) || (!self.state.properties.wallet)
  self._log('getWalletProperties', { errP: errP })
  if (errP) throw new Error('Ledger client initialization incomplete.')

  path = '/v1/wallet/' + self.state.properties.wallet.paymentId
  self._roundTrip({ path: path, method: 'GET' }, function (err, response, body) {
    if (err) return callback(err)

    callback(null, body)
  })
}

Client.prototype.getVerificationURL = function () {
  var errP = (!this.state.properties) || (!this.state.properties.wallet)

  this._log('getVerificationURL', { errP: errP })
  if (errP) throw new Error('Ledger client initialization incomplete.')

  return url.format(underscore.pick(this.options.server, 'protocol', 'hostname', 'port')) +
           '/v1/oauth/bitgo/' + this.state.properties.wallet.paymentId
}

Client.prototype.isReadyToReconcile = function () {
  var delayTime

  if (!this.state.reconcileStamp) {
    this._log('isReadyToReconcile', { errP: true })
    throw new Error('Ledger client initialization incomplete.')
  }

  delayTime = this.state.reconcileStamp - underscore.now()
  this._log('isReadyToReconcile', { delayTime: delayTime })

  return (delayTime <= 0)
}

Client.prototype.reconcile = function (report, callback) {
  var self = this

  var delayTime, path, schema, validity

  if (!callback) {
    callback = report
    report = null
  }
  if (typeof callback !== 'function') throw new Error('missing callback parameter')

  try {
    if (!self.state.reconcileStamp) throw new Error('Ledger client initialization incomplete.')
    if (self.state.properties.setting === 'adFree') {
      if (!report) throw new Error('missing report parameter')

      schema = Joi.array().items(Joi.object().keys(
                 { site: Joi.string().required(), weight: Joi.number().positive().required() }
               )).min(1)

      validity = Joi.validate(report, schema)
      if (validity.error) throw new Error(validity.error)
    }
  } catch (ex) {
    this._log('reconcile', { errP: true })
    throw ex
  }

  delayTime = this.state.reconcileStamp - underscore.now()
  if (delayTime > 0) {
    this._log('reconcile', { delayTime: delayTime })
    return callback(null, null, delayTime)
  }

  this._log('reconcile', { setting: self.state.properties.setting })
  if (self.state.properties.setting !== 'adFree') {
    throw new Error('setting not (yet) supported: ' + self.state.properties.setting)
  }

  path = '/v1/surveyor/browsing/current/' + self.state.properties.wallet.paymentId
  self._roundTrip({ path: path, method: 'GET' }, function (err, response, body) {
    var surveyorInfo = body

    if (err) return callback(err)

    path = '/v1/wallet/' + self.state.properties.wallet.paymentId
    self._roundTrip({ path: path, method: 'GET' }, function (err, response, body) {
      var payload

      self._log('reconcile', { method: 'GET', path: '/v1/wallet/...', errP: !!err })
      if (err) return callback(err)

      if (body.balance < self.state.properties.fee) return callback(new Error('insufficient funds'))

      path = '/v1/wallet/' + self.state.properties.wallet.paymentId
      payload = { amount: self.state.properties.fee, surveyorId: surveyorInfo.surveyorId }
      self._roundTrip({ path: path, method: 'PUT', payload: payload }, function (err, response, body) {
        self._log('reconcile', { method: 'PUT', path: '/v1/wallet/...', errP: !!err })
        if (err) return callback(err)

        self.state.pollTransaction = underscore.defaults(body, { report: report, stamp: self.state.reconcileStamp,
                                                                 surveyorInfo: surveyorInfo,
                                                                 server: self.options.server })
        self.state.reconcileStamp = underscore.now() + self._backOff(self.state.properties.days)

        callback(null, self.state, 100)
      })
    })
  })
}

Client.prototype.report = function () {
  var entries = this.logging

  this.logging = []
  return (entries.length > 0 ? entries : '')
}

/*
 *
 * internal functions
 *
 */

Client.prototype._registerPersona = function (callback) {
  var self = this

  var path

  path = '/v1/registrar/persona/publickey'
  self._roundTrip({ path: path, method: 'GET' }, function (err, response, body) {
    var credential, payload, persona

    self._log('registerPersona', { method: 'GET', path: path, errP: !!err })
    if (err) return callback(err)

    persona = underscore.defaults(body, { server: self.options.server })

    credential = new anonize.Credential(self.state.personaId, persona.registrarVK)

    path = '/v1/registrar/persona/' + self.state.personaId
    try { payload = { proof: credential.request() } } catch (ex) { return callback(ex) }
    self._roundTrip({ path: path, method: 'POST', payload: payload }, function (err, response, body) {
      self._log('registerPersona', { method: 'POST', path: '/v1/registrar/persona/...', errP: !!err })
      if (err) return callback(err)

      try { credential.finalize(body.verification) } catch (ex) { return callback(ex) }
      self.state.persona = JSON.stringify(credential)

      callback(null, self.state, 100)
    })
  })
}

Client.prototype._prepareWallet = function (callback) {
  var self = this

  var path

  path = '/v1/surveyor/wallet/current/' + self.state.personaId
  self._roundTrip({ path: path, method: 'GET' }, function (err, response, body) {
    var delayTime, now, validity
    var schema = Joi.number().positive().required()

    self._log('prepareWallet', { method: 'GET', path: '/v1/surveyor/wallet/current/...', errP: !!err })
    if (err) return callback(err)

    self.state.prepareWallet = underscore.defaults(body, { server: self.options.server })
    validity = Joi.validate(self.state.prepareWallet.payload.adFree.fee, schema)
    if (validity.error) throw new Error(validity.error)

    now = underscore.now()
    delayTime = self._backOff(randomInt(0, self.state.prepareWallet.payload.adFree.pays || 30))
    self.state.delayStamp = now + delayTime

    self._log('prepareWallet', { delayTime: delayTime })
    callback(null, self.state, delayTime)
  })
}

Client.prototype._commitWallet = function (callback) {
  var self = this

  var path, payload
  var surveyor = new anonize.Surveyor(self.state.prepareWallet)

  path = '/v1/surveyor/wallet/' + encodeURIComponent(surveyor.parameters.surveyorId)
  try { payload = { proof: self.credentials.persona.submit(surveyor) } } catch (ex) { return callback(ex) }
  self._roundTrip({ path: path, method: 'PUT', payload: payload }, function (err, response, body) {
    self._log('commitWallet', { method: 'PUT', path: '/v1/surveyor/wallet/...', errP: !!err })
    if (err) return callback(err)

    self.state.properties = underscore.extend({ setting: 'adFree',
                                                fee: self.state.prepareWallet.payload.adFree.fee,
                                                days: self.state.prepareWallet.payload.adFree.days || 30,
                                                configuration: self.state.prepareWallet.payload },
                                              underscore.pick(body, 'wallet'))
    delete self.state.prepareWallet

    callback(null, self.state, 100)
  })
}

Client.prototype._registerWallet = function (callback) {
  var self = this

  var path

  path = '/v1/registrar/wallet/publickey'
  self._roundTrip({ path: path, method: 'GET' }, function (err, response, body) {
    var credential, payload, wallet

    self._log('registerWallet', { method: 'GET', path: path, errP: !!err })
    if (err) return callback(err)

    wallet = underscore.defaults(body, { server: self.options.server })

    credential = new anonize.Credential(self.state.properties.wallet.paymentId, wallet.registrarVK)

    path = '/v1/registrar/wallet/' + self.state.properties.wallet.paymentId
    try { payload = { proof: credential.request() } } catch (ex) { return callback(ex) }
    self._roundTrip({ path: path, method: 'POST', payload: payload }, function (err, response, body) {
      self._log('registerWallet', { method: 'POST', path: '/v1/registrar/wallet/...', errP: !!err })
      if (err) return callback(err)

      try { credential.finalize(body.verification) } catch (ex) { return callback(ex) }
      self.state.wallet = JSON.stringify(credential)
      self.state.bootStamp = underscore.now()
      self.state.reconcileStamp = self.state.bootStamp + self._backOff(self.state.properties.days)

      callback(null, self.state, 100)
    })
  })
}

Client.prototype._prepareTransaction = function (callback) {
  var self = this

  var path

  path = '/v1/wallet/' + self.state.properties.wallet.paymentId
  self._roundTrip({ path: path, method: 'GET' }, function (err, response, body) {
    var delayTime, now

    self._log('prepareTransaction', { method: 'GET', path: '/v1/wallet/...', errP: !!err })
    if (err) return callback(err)

    if ((!body.lastPaymentStamp) || (body.lastPaymentStamp < self.state.pollTransaction.stamp)) {
      return callback(null, null, randomInt(0, 10 * 60 * 1000))
    }

    self.state.prepareTransaction = underscore.defaults(underscore.pick(self.state.pollTransaction,
                                                                        [ 'report', 'surveyorInfo' ]),
                                                        { server: self.options.server })
    delete self.state.pollTransaction

    now = underscore.now()
    delayTime = self._backOff(randomInt(0, 1))
    self.state.delayStamp = now + delayTime

    self._log('prepareTransaction', { delayTime: delayTime })
    callback(null, self.state, delayTime)
  })
}

Client.prototype._submitTransaction = function (callback) {
  var self = this

  var path, payload
  var surveyor = new anonize.Surveyor(self.state.prepareTransaction.surveyorInfo)

  path = '/v1/surveyor/browsing/' + encodeURIComponent(surveyor.parameters.surveyorId)
  try {
    payload = { proof: self.credentials.wallet.submit(surveyor, { report: self.state.prepareTransaction.report }) }
  } catch (ex) { return callback(ex) }
  self._roundTrip({ path: path, method: 'PUT', payload: payload }, function (err, response, body) {
    self._log('submitTransaction', { method: 'PUT', path: '/v1/surveyor/browsing/...', errP: !!err })
    if (err) return callback(err)

    delete self.state.prepareTransaction

    callback(null, self.state, 100)
  })
}

Client.prototype._backOff = function (days) {
  return (this.options.debugP ? 1 : days * 86400) * 1000
}

Client.prototype._log = function (who, args) {
  if (this.options.loggingP) this.logging.push({ timestamp: underscore.now(), who: who, args: args || {} })
}

// round-trip to the ledger
Client.prototype._roundTrip = function (options, callback) {
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
