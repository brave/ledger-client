var anonize = require('node-anonize2-relic')
var http = require('http')
var https = require('https')
var Joi = require('joi')
var ledgerPublisher = require('ledger-publisher')
var random = require('random-lib')
var underscore = require('underscore')
var url = require('url')

var Client = function (personaId, options, state) {
  if (!(this instanceof Client)) return new Client(personaId, options, state)

  var self = this

  self.options = underscore.defaults(options || {},
                                     { server: 'https://ledger.brave.com', debugP: false, loggingP: false, verboseP: false })
  if (typeof self.options.server === 'string') self.options.server = url.parse(self.options.server)
  self.state = underscore.defaults(state || {}, { personaId: personaId, options: self.options })
  self.logging = []
}

Client.prototype.sync = function (callback) {
  var self = this

  var delayTime

  if (typeof callback !== 'function') throw new Error('missing callback parameter')

  if (!self.state.ruleset) {
    self.state.ruleset = ledgerPublisher.rules

    self._updateRules(function (err) { if (err) console.log(err) })
  }

  if (self.state.delayStamp) {
    delayTime = self.state.delayStamp - underscore.now()
    if (delayTime > 0) {
      self._log('sync', { reason: 'next event', delayTime: delayTime })
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

  if ((self.state.reconcileStamp) && ((underscore.now() - self.state.reconcileStamp) > 0)) {
    delayTime = random.randomInt({ min: 0, max: 10 * 60 * 1000 })
    self._log('sync', { reason: 'next reconciliation', delayTime: delayTime, reconcileStamp: self.state.reconcileStamp })
    return callback(null, null, delayTime)
  }

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

Client.prototype.timeUntilReconcile = function () {
  if (!this.state.reconcileStamp) {
    this._log('isReadyToReconcile', { errP: true })
    throw new Error('Ledger client initialization incomplete.')
  }

  if ((this.state.pollTransaction) || (this.state.prepareTransaction)) {
    this._log('isReadyToReconcile', { reason: 'already reconciling', reconcileStamp: this.state.reconcileStamp })
    return false
  }

  return (this.state.reconcileStamp - underscore.now())
}

Client.prototype.isReadyToReconcile = function () {
  var delayTime = this.timeUntilReconcile()

  this._log('isReadyToReconcile', { delayTime: delayTime })
  return ((typeof delayTime === 'boolean') ? delayTime : (delayTime <= 0))
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
                 { publisher: Joi.string().required(), weight: Joi.number().positive().required() }
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
    this._log('reconcile', { reason: 'not time to reconcile', delayTime: delayTime })
    return callback(null, null, delayTime)
  }
  if ((this.state.pollTransaction) || (this.state.prepareTransaction)) {
    delayTime = random.randomInt({ min: 0, max: 10 * 60 * 1000 })
    this._log('reconcile', { reason: 'already reconciling', delayTime: delayTime, reconcileStamp: this.state.reconcileStamp })
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

    path = '/v1/wallet/' + self.state.properties.wallet.paymentId + '?currency=' + self.state.properties.fee.currency
    self._roundTrip({ path: path, method: 'GET' }, function (err, response, body) {
      var amount, btc, currency

      self._log('reconcile', { method: 'GET', path: '/v1/wallet/...', errP: !!err })
      if (err) return callback(err)

      if (body.mode === 'internal') {
        amount = self.state.properties.fee.amount
        currency = self.state.properties.fee.currency

        if (!body.rates[currency]) {
          self._log('reconcile', { error: currency + ' no longer supported by the ledger' })
          return callback(new Error(currency + ' no longer supported by the ledger'))
        }

        btc = (amount / body.rates[currency]).toFixed(4)
        if (body.balance < btc) {
          self.state.thisPayment = { paymentURL: 'bitcoin:' + self.state.properties.wallet.address + '?amount=' + btc,
                                     address: self.state.properties.wallet.address,
                                     btc: btc,
                                     amount: amount,
                                     currency: currency
                                   }

          self._log('reconcile', { reason: 'balance < btc', balance: body.balance, btc: btc, delayTime: 100 })
          return callback(null, self.state, 100)
        }
      }

      self._updateWallet({ report: report, surveyorInfo: surveyorInfo }, callback)
    })
  })
}

Client.prototype.report = function () {
  var entries = this.logging

  this.logging = []
  if (entries.length) return entries
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

    self._log('_registerPersona', { method: 'GET', path: path, errP: !!err })
    if (err) return callback(err)

    persona = underscore.defaults(body, { server: self.options.server })

    credential = new anonize.Credential(self.state.personaId, persona.registrarVK)

    path = '/v1/registrar/persona/' + self.state.personaId
    try { payload = { proof: credential.request() } } catch (ex) { return callback(ex) }
    self._roundTrip({ path: path, method: 'POST', payload: payload }, function (err, response, body) {
      self._log('_registerPersona', { method: 'POST', path: '/v1/registrar/persona/...', errP: !!err })
      if (err) return callback(err)

      try { credential.finalize(body.verification) } catch (ex) { return callback(ex) }
      self.state.persona = JSON.stringify(credential)

      self._log('_registerPersona', { delayTime: 100 })
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
    var schema = Joi.object({}).pattern(/[A-Z][A-Z][A-Z]/, Joi.number().positive()).unknown(true).required()

    self._log('_prepareWallet', { method: 'GET', path: '/v1/surveyor/wallet/current/...', errP: !!err })
    if (err) return callback(err)

    self.state.prepareWallet = underscore.defaults(body, { server: self.options.server })
    validity = Joi.validate(self.state.prepareWallet.payload.adFree.fee, schema)
    if (validity.error) throw new Error(validity.error)

    now = underscore.now()
    delayTime = self._backOff(random.randomInt({ min: 0, max: self.state.prepareWallet.payload.adFree.days || 30 }))
    self.state.delayStamp = now + delayTime

    self._log('_prepareWallet', { delayTime: delayTime })
    callback(null, self.state, delayTime)
  })
}

Client.prototype._commitWallet = function (callback) {
  var self = this

  var path, payload
  var surveyor = new anonize.Surveyor(self.state.prepareWallet)

  path = '/v1/surveyor/wallet/' + encodeURIComponent(surveyor.parameters.surveyorId)
  try {
    payload = { proof: self.credentials.persona.submit(surveyor,
                                                       self.options.wallet ? { wallet: self.options.wallet } : {}) }
  } catch (ex) { return callback(ex) }
  self._roundTrip({ path: path, method: 'PUT', payload: payload }, function (err, response, body) {
    var currency, fee

    self._log('_commitWallet', { method: 'PUT', path: '/v1/surveyor/wallet/...', errP: !!err })
    if (err) return callback(err)

    currency = (self.options.wallet && self.options.wallet.currency) || 'USD'
    if (!self.state.prepareWallet.payload.adFree.fee[currency]) {
      if (!self.state.prepareWallet.payload.adFree.fee.USD) {
        self._log('_commitWallet', { error: 'neither ' + currency + ' nor USD are supported by the ledger' })
        return callback(new Error('neither ' + currency + ' nor USD are supported by the ledger'))
      }
      currency = 'USD'
    }
    fee = { currency: currency, amount: self.state.prepareWallet.payload.adFree.fee[currency] }

    self.state.properties = underscore.extend({ setting: 'adFree',
                                                fee: fee,
                                                days: self.state.prepareWallet.payload.adFree.days || 30,
                                                configuration: self.state.prepareWallet.payload
                                              }, underscore.pick(body, 'wallet'))
    delete self.state.prepareWallet

    self._log('_commitWallet', { delayTime: 100 })
    callback(null, self.state, 100)
  })
}

Client.prototype._registerWallet = function (callback) {
  var self = this

  var path

  path = '/v1/registrar/wallet/publickey'
  self._roundTrip({ path: path, method: 'GET' }, function (err, response, body) {
    var credential, payload, wallet

    self._log('_registerWallet', { method: 'GET', path: path, errP: !!err })
    if (err) return callback(err)

    wallet = underscore.defaults(body, { server: self.options.server })

    credential = new anonize.Credential(self.state.properties.wallet.paymentId, wallet.registrarVK)

    path = '/v1/registrar/wallet/' + self.state.properties.wallet.paymentId
    try { payload = { proof: credential.request() } } catch (ex) { return callback(ex) }
    self._roundTrip({ path: path, method: 'POST', payload: payload }, function (err, response, body) {
      self._log('_registerWallet', { method: 'POST', path: '/v1/registrar/wallet/...', errP: !!err })
      if (err) return callback(err)

      try { credential.finalize(body.verification) } catch (ex) { return callback(ex) }
      self.state.wallet = JSON.stringify(credential)
      self.state.bootStamp = underscore.now()
      if (self.options.verboseP) self.state.bootDate = new Date(self.state.bootStamp)
      self.state.reconcileStamp = self.state.bootStamp + self._backOff(self.state.properties.days)
      if (self.options.verboseP) self.state.reconcileDate = new Date(self.state.reconcileStamp)

      self._log('_registerWallet', { delayTime: 100 })
      callback(null, self.state, 100)
    })
  })
}

Client.prototype._updateWallet = function (props, callback) {
  var self = this
  var path = '/v1/wallet/' + self.state.properties.wallet.paymentId
  var surveyorInfo = props.surveyorInfo
  var payload = underscore.extend({ surveyorId: surveyorInfo.surveyorId }, self.state.properties.fee)

  self._roundTrip({ path: path, method: 'PUT', payload: payload }, function (err, response, body) {
    self._log('reconcile', { method: 'PUT', path: '/v1/wallet/...', errP: !!err })
    if (err) return callback(err)

    if (!self.state.pollTransaction) {
      self.state.pollTransaction = underscore.defaults(body, { report: props.report,
                                                               stamp: self.state.reconcileStamp,
                                                               surveyorInfo: surveyorInfo,
                                                               server: self.options.server
                                                             })
      if (self.options.verboseP) self.state.pollTransaction.date = self.state.reconcileDate
    }
    if (body.paymentInfo) {
      self.state.thisPayment = underscore.extend(body.paymentInfo,
                                                 { reconcileId: surveyorInfo.surveyorId,
                                                   paymentStamp: self.state.reconcileStamp
                                                 })
      if (self.options.verboseP) self.state.thisPayment.paymentDate = self.state.reconcileDate
      delete body.paymentURL
    }
    self.state.reconcileStamp = underscore.now() + self._backOff(self.state.properties.days)
    if (self.options.verboseP) self.state.reconcileDate = new Date(self.state.reconcileStamp)

    self._updateRules(function (err) {
      if (err) console.log(err)

      self._log('_updateWallet', { delayTime: 100 })
      callback(null, self.state, 100)
    })
  })
}

Client.prototype._prepareTransaction = function (callback) {
  var self = this

  var path

  path = '/v1/wallet/' + self.state.properties.wallet.paymentId + '?currency=' + self.state.properties.fee.currency
  self._roundTrip({ path: path, method: 'GET' }, function (err, response, body) {
    var delayTime, info, now

    self._log('_prepareTransaction', { method: 'GET', path: '/v1/wallet/...', errP: !!err })
    if (err) return callback(err)

    if ((!body.lastPaymentStamp) || (body.lastPaymentStamp < self.state.pollTransaction.stamp)) {
      delayTime = random.randomInt({ min: 0, max: 10 * 60 * 1000 })
      self._log('_prepareTransaction', { reason: 'lastPaymentStamp < pollTransactionStamp',
                                         lastPaymentStamp: body.lastPaymentStamp,
                                         pollTransactionStamp: self.state.pollTransaction.stamp,
                                         delayTime: delayTime })

      info = self.state.pollTransaction.paymentInfo
      if ((!info) || (!info.infoExpires) || (info.infoExpires <= underscore.now())) return callback(null, null, delayTime)

      return self._updateWallet(self.state.pollTransaction, callback)
    }

    self.state.prepareTransaction = underscore.defaults(underscore.pick(self.state.pollTransaction,
                                                                        [ 'report', 'surveyorInfo' ]),
                                                        { server: self.options.server })
    delete self.state.pollTransaction

    now = underscore.now()
    delayTime = self._backOff(random.randomInt({min: 0, max: 1}))
    self.state.delayStamp = now + delayTime

    self._log('_prepareTransaction', { delayTime: delayTime })
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
    self._log('_submitTransaction', { method: 'PUT', path: '/v1/surveyor/browsing/...', errP: !!err })
    if (err) return callback(err)

    delete self.state.prepareTransaction

    self._log('_submitTransaction', { delayTime: 100 })
    callback(null, self.state, 100)
  })
}

Client.prototype._backOff = function (days) {
  return (this.options.debugP ? 1 : days * 86400) * 1000
}

Client.prototype._log = function (who, args) {
  if (this.options.debugP) console.log(JSON.stringify({ who: who, what: args || {}, when: underscore.now() }, null, 2))
  if (this.options.loggingP) this.logging.push({ who: who, what: args || {}, when: underscore.now() })
}

Client.prototype._updateRules = function (callback) {
  var path
  var self = this

  path = '/v1/publisher/ruleset'
  self._roundTrip({ path: path, method: 'GET' }, function (err, response, ruleset) {
    var validity

    self._log('_updateRules', { method: 'GET', path: '/v1/publisher/ruleset', errP: !!err })
    if (err) return callback(err)

    validity = Joi.validate(ruleset, ledgerPublisher.schema)
    if (validity.error) {
      self._log('_updateRules', { error: validity.error })
      return callback(new Error(validity.error))
    }

    if (!underscore.isEqual(self.state.ruleset || [], ruleset)) {
      self.state.ruleset = ruleset

      ledgerPublisher.rules = ruleset
    }

    callback()
  })
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
      if (Math.floor(response.statusCode / 100) !== 2) {
        self._log('_roundTrip', { error: 'HTTP response ' + response.statusCode })
        return callback(new Error('HTTP response ' + response.statusCode))
      }

      try {
        payload = (response.statusCode !== 204) ? JSON.parse(body) : null
      } catch (err) {
        return callback(err)
      }
      if (self.options.verboseP) console.log('>>> ' + JSON.stringify(payload, null, 2).split('\n').join('\n>>> '))

      try {
        callback(null, response, payload)
      } catch (err0) {
        if (self.options.verboseP) console.log('callback: ' + err0.toString() + '\n' + err0.stack)
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

module.exports = Client
