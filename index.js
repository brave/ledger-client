var anonize = require('node-anonize2-relic-emscripten')
var bitgo = new (require('bitgo')).BitGo({ env: 'prod' })
var http = require('http')
var https = require('https')
var Joi = require('joi')
var ledgerPublisher = require('ledger-publisher')
var random = require('random-lib')
var underscore = require('underscore')
var url = require('url')
var util = require('util')
var uuid = require('node-uuid')

var Client = function (personaId, options, state) {
  if (!(this instanceof Client)) return new Client(personaId, options, state)

  var self = this

  if (!personaId) personaId = uuid.v4().toLowerCase()

  self.options = underscore.defaults(underscore.clone(options || {}),
                                     { server: 'https://ledger.brave.com', debugP: false, loggingP: false, verboseP: false })
  underscore.keys(self.options).forEach(function (option) {
    if ((option.lastIndexOf('P') + 1) === option.length) self.options[option] = Client.prototype.boolion(self.options[option])
  })
  if (typeof self.options.server === 'string') self.options.server = url.parse(self.options.server)
  if (typeof self.options.roundtrip !== 'undefined') {
    if (typeof self.options.roundtrip !== 'function') throw new Error('invalid roundtrip option (must be a function)')

    self._innerTrip = self.options.roundtrip.bind(self)
    self.roundtrip = function (params, callback) { self._innerTrip(params, self.options, callback) }
  } else {
    self.roundtrip = self._roundTrip
  }

  self.state = underscore.defaults(state || {}, { personaId: personaId, options: self.options, ballots: [], transactions: [] })
  self.logging = []

  if (self.state.wallet) throw new Error('deprecated state (alpha) format')
}

var msecs = { day: 24 * 60 * 60 * 1000,
              hour: 60 * 60 * 1000,
              minute: 60 * 1000,
              second: 1000
            }

Client.prototype.sync = function (callback) {
  var self = this

  var ballot, ballots, i, transaction
  var now = underscore.now()

  if (typeof callback !== 'function') throw new Error('sync missing callback parameter')

  if (!this.state.ruleset) {
    this.state.ruleset = ledgerPublisher.rules

    ledgerPublisher.getRules(function (err, rules) {
      if (err) self._log('getRules', { message: err.toString() })
      if (rules) self.state.ruleset = rules

      self._updateRules(function (err) { if (err) self._log('updateRules', { message: err.toString() }) })
    })
  }

  if (this.state.rulesStamp < now) {
    return this._updateRules(function (err) {
      if (err) self._log('_updateRules', { message: err.toString() })

      self._log('sync', { delayTime: msecs.minute })
      callback(null, self.state, msecs.minute)
    })
  }

  if (!this.credentials) this.credentials = {}

  if (!this.state.persona) return this._registerPersona(callback)
  this.credentials.persona = new anonize.Credential(this.state.persona)

  ballots = underscore.shuffle(this.state.ballots)
  for (i = ballots.length - 1; i >= 0; i--) {
    ballot = ballots[i]
    transaction = underscore.find(this.state.transactions, function (transaction) {
      return ((transaction.credential) &&
              (ballot.viewingId === transaction.viewingId) &&
              ((!ballot.prepareBallot) || (!ballot.delayStamp) || (ballot.delayStamp <= now)))
    })
    if (!transaction) continue

    if (!ballot.prepareBallot) return this._prepareBallot(ballot, transaction, callback)
    return this._commitBallot(ballot, transaction, callback)
  }

  transaction = underscore.find(this.state.transactions, function (transaction) {
    if (transaction.credential) return

    try { return this._registerViewing(transaction.viewingId, callback) } catch (ex) {
      this._log('_registerViewing', { errP: 1, message: ex.toString(), stack: ex.stack })
    }
  }, this)

  if (this.state.currentReconcile) return this._currentReconcile(callback)

  this._log('sync', { result: true })
  return true
}

var propertyList = [ 'setting', 'days', 'fee' ]

Client.prototype.getBraveryProperties = function () {
  var errP

  errP = !this.state.properties
  this._log('getBraveryProperties', { errP: errP, result: underscore.pick(this.state.properties || {}, propertyList) })
  if (errP) throw new Error('Ledger client initialization incomplete.')

  return underscore.pick(this.state.properties, propertyList)
}

Client.prototype.setBraveryProperties = function (properties, callback) {
  var self = this

  if (typeof callback !== 'function') throw new Error('setBraveryProperties missing callback parameter')

  properties = underscore.pick(properties, propertyList)
  self._log('setBraveryProperties', properties)

  underscore.defaults(self.state.properties, properties)
  callback(null, self.state)
}

Client.prototype.getWalletAddress = function () {
  this._log('getWalletAddress')

  return this.state.properties && this.state.properties.wallet && this.state.properties.wallet.address
}

Client.prototype.getWalletPassphrase = function () {
  this._log('getWalletPassphrase')

  return this.state.properties && this.state.properties.wallet && this.state.properties.wallet.keychains &&
         this.state.properties.wallet.keychains.passphrase
}

Client.prototype.getWalletProperties = function (amount, currency, callback) {
  var self = this

  var errP, path

  if (typeof amount === 'function') {
    callback = amount
    amount = null
    currency = null
  } else if (typeof currency === 'function') {
    callback = currency
    currency = null
  }

  if (typeof callback !== 'function') throw new Error('getWalletProperties missing callback parameter')

  errP = (!self.state.properties) || (!self.state.properties.wallet)
  self._log('getWalletProperties', { errP: errP })
  if (errP) throw new Error('Ledger client initialization incomplete.')

  path = '/v1/wallet/' + self.state.properties.wallet.paymentId + '?balance=true'
  if (amount) path += '&amount=' + amount
  if (currency) path += '&currency=' + currency
  self.roundtrip({ path: path, method: 'GET' }, function (err, response, body) {
    self._log('getWalletProperties', { method: 'GET', path: '/v1/wallet/...', errP: !!err })
    if (err) return callback(err)

    callback(null, body)
  })
}

Client.prototype.setTimeUntilReconcile = function (timestamp, callback) {
  var now = underscore.now()

  if ((!timestamp) || (timestamp < now)) timestamp = now + this._backOff(this.state.properties.days)
  this.state.reconcileStamp = timestamp
  if (this.options.verboseP) this.state.reconcileDate = new Date(this.state.reconcileStamp)

  callback(null, this.state)
}

Client.prototype.timeUntilReconcile = function () {
  if (!this.state.reconcileStamp) {
    this._log('isReadyToReconcile', { errP: true })
    throw new Error('Ledger client initialization incomplete.')
  }

  if (this.state.currentReconcile) {
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

Client.prototype.reconcile = function (viewingId, callback) {
  var self = this

  var delayTime, path, schema, validity

  if (!callback) {
    callback = viewingId
    viewingId = null
  }
  if (typeof callback !== 'function') throw new Error('reconcile missing callback parameter')

  try {
    if (!self.state.reconcileStamp) throw new Error('Ledger client initialization incomplete.')
    if (self.state.properties.setting === 'adFree') {
      if (!viewingId) throw new Error('missing viewingId parameter')

      schema = Joi.string().guid().required().description('opaque identifier for viewing submissions')

      validity = Joi.validate(viewingId, schema)
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
  if (this.state.currentReconcile) {
    delayTime = random.randomInt({ min: msecs.second, max: (this.options.debugP ? 1 : 10) * msecs.minute })
    this._log('reconcile', { reason: 'already reconciling', delayTime: delayTime, reconcileStamp: this.state.reconcileStamp })
    return callback(null, null, delayTime)
  }

  this._log('reconcile', { setting: self.state.properties.setting })
  if (self.state.properties.setting !== 'adFree') {
    throw new Error('setting not (yet) supported: ' + self.state.properties.setting)
  }

  path = '/v1/surveyor/contribution/current/' + self.credentials.persona.parameters.userId
  self.roundtrip({ path: path, method: 'GET', useProxy: true }, function (err, response, body) {
    var i
    var surveyorInfo = body

    self._log('reconcile', { method: 'GET', path: '/v1/surveyor/contribution/current/...', errP: !!err })
    if (err) return callback(err)

    for (i = self.state.transactions.length - 1; i >= 0; i--) {
      if (self.state.transactions[i].surveyorId !== surveyorInfo.surveyorId) continue

      delayTime = random.randomInt({ min: msecs.second, max: (self.options.debugP ? 1 : 10) * msecs.minute })
      self._log('reconcile',
                { reason: 'awaiting a new surveyorId', delayTime: delayTime, surveyorId: surveyorInfo.surveyorId })
      return callback(null, null, delayTime)
    }

    self.state.currentReconcile = { viewingId: viewingId, surveyorInfo: surveyorInfo, timestamp: 0 }
    self._log('reconcile', { delayTime: msecs.minute })
    callback(null, self.state, msecs.minute)
  })
}

Client.prototype.ballots = function (viewingId) {
  var i, count, transaction

  count = 0
  for (i = this.state.transactions.length - 1; i >= 0; i--) {
    transaction = this.state.transactions[i]
    if ((transaction.votes < transaction.count) && ((transaction.viewingId === viewingId) || (!viewingId))) {
      count += transaction.count - transaction.votes
    }
  }
  return count
}

Client.prototype.vote = function (publisher, viewingId) {
  var i, transaction

  if (!publisher) throw new Error('missing publisher parameter')

  for (i = this.state.transactions.length - 1; i >= 0; i--) {
    transaction = this.state.transactions[i]
    if (transaction.votes >= transaction.count) continue

    if ((transaction.viewingId === viewingId) || (!viewingId)) break
  }
  if (i < 0) return

  this.state.ballots.push({ viewingId: transaction.viewingId,
                            surveyorId: transaction.surveyorIds[transaction.votes],
                            publisher: publisher,
                            offset: transaction.votes
                          })
  transaction.votes++

  return this.state
}

Client.prototype.report = function () {
  var entries = this.logging

  this.logging = []
  if (entries.length) return entries
}

Client.prototype.recoverWallet = function (recoveryId, passPhrase, callback) {
  var self = this

  var path, payload

  path = '/v1/wallet/' + self.state.properties.wallet.paymentId + '/recover'
  payload = { recoveryId: recoveryId, passPhrase: passPhrase }
  self.roundtrip({ path: path, method: 'PUT', payload: payload }, function (err, response, body) {
    self._log('recoverWallet', { method: 'PUT', path: '/v1/wallet/.../recover', errP: !!err })
    if (err) return callback(err)

    self._log('recoverWallet', body)
    callback(null, body)
  })
}

/*
 *
 * internal functions
 *
 */

Client.prototype._registerPersona = function (callback) {
  var self = this

  var path

  path = '/v1/registrar/persona'
  self.roundtrip({ path: path, method: 'GET' }, function (err, response, body) {
    var credential, keychains, passphrase, payload

    self._log('_registerPersona', { method: 'GET', path: path, errP: !!err })
    if (err) return callback(err)

    credential = new anonize.Credential(self.state.personaId, body.registrarVK)

    passphrase = self.options.debugP ? 'hello world.' : uuid.v4().toLowerCase()
    keychains = { user: bitgo.keychains().create(), passphrase: passphrase }
    keychains.user.encryptedXprv = bitgo.encrypt({ password: keychains.passphrase, input: keychains.user.xprv })
    keychains.user.path = 'm'

    path = '/v1/registrar/persona/' + credential.parameters.userId
    try {
      payload = { keychains: { user: underscore.omit(keychains.user, [ 'xprv' ]) }, proof: credential.request() }
    } catch (ex) { return callback(ex) }
    self.roundtrip({ path: path, method: 'POST', payload: payload }, function (err, response, body) {
      var configuration, currency, days, fee

      self._log('_registerPersona', { method: 'POST', path: '/v1/registrar/persona/...', errP: !!err })
      if (err) return callback(err)

      try { credential.finalize(body.verification) } catch (ex) { return callback(ex) }
      self.credentials.persona = credential
      self.state.persona = JSON.stringify(credential)

      configuration = body.payload && body.payload.adFree
      if (!configuration) {
        self._log('_registerPersona', { error: 'persona registration missing adFree configuration' })
        return callback(new Error('persona registration missing adFree configuration'))
      }

      currency = configuration.currency || 'USD'
      days = configuration.days || 30
      if (!configuration.fee[currency]) {
        if (currency === 'USD') {
          self._log('_registerPersona', { error: 'USD is not supported by the ledger' })
          return callback(new Error('USD is not supported by the ledger'))
        }
        if (!configuration.fee.USD) {
          self._log('_registerPersona', { error: 'neither ' + currency + ' nor USD are supported by the ledger' })
          return callback(new Error('neither ' + currency + ' nor USD are supported by the ledger'))
        }
        currency = 'USD'
      }
      fee = { currency: currency, amount: configuration.fee[currency] }
      self.state.properties = { setting: 'adFree',
                                fee: fee,
                                days: days,
                                configuration: body.contributions,
                                wallet: underscore.extend(body.wallet, { keychains: keychains })
                              }
      self.state.bootStamp = underscore.now()
      if (self.options.verboseP) self.state.bootDate = new Date(self.state.bootStamp)
      self.state.reconcileStamp = self.state.bootStamp + self._backOff(self.state.properties.days)
      if (self.options.verboseP) self.state.reconcileDate = new Date(self.state.reconcileStamp)

      self._log('_registerPersona', { delayTime: msecs.minute })
      callback(null, self.state, msecs.minute)
    })
  })
}

Client.prototype._currentReconcile = function (callback) {
  var self = this

  var fee, rates, wallet
  var amount = self.state.properties.fee.amount
  var currency = self.state.properties.fee.currency
  var path = '/v1/wallet/' + self.state.properties.wallet.paymentId
  var surveyorInfo = self.state.currentReconcile.surveyorInfo
  var viewingId = self.state.currentReconcile.viewingId

  path = '/v1/wallet/' + self.state.properties.wallet.paymentId +
           '?refresh=true' + '&amount=' + amount + '&currency=' + currency
  self.roundtrip({ path: path, method: 'GET' }, function (err, response, body) {
    var btc, delayTime

    self._log('_currentReconcile', { method: 'GET', path: '/v1/wallet/...', errP: !!err })
    if (err) return callback(err)

    if (!body.unsignedTx) {
      if (body.rates[currency]) {
        btc = (amount / body.rates[currency]).toFixed(4)
      } else {
        self._log('reconcile', { error: currency + ' no longer supported by the ledger' })
      }

      self.state.paymentInfo = underscore.extend(underscore.pick(body, [ 'balance', 'buyURL', 'recurringURL', 'satoshis' ]),
                                 { address: self.state.properties.wallet.address,
                                   btc: btc,
                                   amount: amount,
                                   currency: currency
                                 })

      delayTime = random.randomInt({ min: msecs.second, max: (self.options.debugP ? 1 : 10) * msecs.minute })
      self._log('_currentReconcile', { reason: 'balance < btc', balance: body.balance, btc: btc, delayTime: delayTime })
      return callback(null, self.state, delayTime)
    }

    fee = body.unsignedTx.fee
    rates = body.rates

    wallet = bitgo.newWalletObject({ wallet: { id: self.state.properties.wallet.address } })
    wallet.signTransaction({ transactionHex: body.unsignedTx.transactionHex,
                             unspents: body.unsignedTx.unspents,
                             keychain: self.state.properties.wallet.keychains.user
                           }, function (err, signedTx) {
      var payload

      self._log('_currentReconcile', { wallet: 'signTransaction', errP: !!err })
      if (err) return callback(err)

      path = '/v1/wallet/' + self.state.properties.wallet.paymentId
      payload = { viewingId: viewingId, surveyorId: surveyorInfo.surveyorId, signedTx: signedTx.tx }
      self.roundtrip({ path: path, method: 'PUT', payload: payload }, function (err, response, body) {
        var transaction

        self._log('_currentReconcile', { method: 'PUT', path: '/v1/wallet/...', errP: !!err })
        if (err) return callback(err)

        transaction = { viewingId: viewingId,
                        surveyorId: surveyorInfo.surveyorId,
                        contribution: { fiat: { amount: amount, currency: currency },
                                        rates: rates,
                                        satoshis: body.satoshis,
                                        fee: fee
                                      },
                        submissionStamp: body.paymentStamp,
                        submissionDate: self.options.verboseP ? new Date(body.paymentStamp) : undefined,
                        submissionId: body.hash
                      }
        self.state.transactions.push(transaction)
        delete self.state.currentReconcile

        self.state.reconcileStamp = underscore.now() + self._backOff(self.state.properties.days)
        if (self.options.verboseP) self.state.reconcileDate = new Date(self.state.reconcileStamp)

        self._updateRules(function (err) {
          if (err) self._log('_updateRules', { message: err.toString() })

          self._log('_currentReconcile', { delayTime: msecs.minute })
          callback(null, self.state, msecs.minute)
        })
      })
    })
  })
}

Client.prototype._registerViewing = function (viewingId, callback) {
  var self = this

  var path = '/v1/registrar/viewing'
  self.roundtrip({ path: path, method: 'GET' }, function (err, response, body) {
    var credential, payload

    self._log('_registerViewing', { method: 'GET', path: path, errP: !!err })
    if (err) return callback(err)

    credential = new anonize.Credential(viewingId, body.registrarVK)

    path = '/v1/registrar/viewing/' + credential.parameters.userId
    try { payload = { proof: credential.request() } } catch (ex) { return callback(ex) }
    self.roundtrip({ path: path, method: 'POST', payload: payload }, function (err, response, body) {
      var i

      self._log('_registerViewing', { method: 'POST', path: '/v1/registrar/viewing/...', errP: !!err })
      if (err) return callback(err)

      try { credential.finalize(body.verification) } catch (ex) { return callback(ex) }

      for (i = self.state.transactions.length - 1; i >= 0; i--) {
        if (self.state.transactions[i].viewingId !== viewingId) continue

        // NB: use of `underscore.extend` requires that the parameter be `self.state.transactions[i]`
        underscore.extend(self.state.transactions[i],
                          { credential: JSON.stringify(credential),
                            surveyorIds: body.surveyorIds,
                            count: body.surveyorIds.length,
                            satoshis: body.satoshis,
                            votes: 0
                          })
        self._log('_registerViewing', { delayTime: msecs.minute })
        return callback(null, self.state, msecs.minute)
      }

      callback(new Error('viewingId ' + viewingId + ' not found in transaction list'))
    })
  })
}

Client.prototype._prepareBallot = function (ballot, transaction, callback) {
  var self = this

  var path
  var credential = new anonize.Credential(transaction.credential)

  path = '/v1/surveyor/voting/' + encodeURIComponent(ballot.surveyorId) + '/' + credential.parameters.userId
  self.roundtrip({ path: path, method: 'GET', useProxy: true }, function (err, response, body) {
    var delayTime, now

    self._log('_prepareBallot', { method: 'GET', path: '/v1/surveyor/voting/...', errP: !!err })
    if (err) return callback(transaction.err = err)

    ballot.prepareBallot = underscore.defaults(body, { server: self.options.server })

    now = underscore.now()
    delayTime = random.randomInt({ min: msecs.second, max: self.options.debugP ? msecs.minute : 3 * msecs.hour })
    ballot.delayStamp = now + delayTime
    if (self.options.verboseP) ballot.delayDate = new Date(ballot.delayStamp)

    self._log('_prepareBallot', { delayTime: msecs.minute })
    callback(null, self.state, msecs.minute)
  })
}

Client.prototype._commitBallot = function (ballot, transaction, callback) {
  var self = this

  var path, payload
  var credential = new anonize.Credential(transaction.credential)
  var surveyor = new anonize.Surveyor(ballot.prepareBallot)

  path = '/v1/surveyor/voting/' + encodeURIComponent(surveyor.parameters.surveyorId)
  try { payload = { proof: credential.submit(surveyor, { publisher: ballot.publisher }) } } catch (ex) { return callback(ex) }
  self.roundtrip({ path: path, method: 'PUT', useProxy: true, payload: payload }, function (err, response, body) {
    var i

    self._log('_commitBallot', { method: 'PUT', path: '/v1/surveyor/voting/...', errP: !!err })
    if (err) return callback(transaction.err = err)

    if (!transaction.ballots) transaction.ballots = {}
    if (!transaction.ballots[ballot.publisher]) transaction.ballots[ballot.publisher] = 0
    transaction.ballots[ballot.publisher]++

    for (i = self.state.ballots.length - 1; i >= 0; i--) {
      if (self.state.ballots[i] !== ballot) continue

      self.state.ballots.splice(i, 1)
      break
    }

    self._log('_commitBallot', { delayTime: msecs.minute })
    callback(null, self.state, msecs.minute)
  })
}

Client.prototype._backOff = function (days) {
  return (days * (this.options.debugP ? msecs.second : msecs.day))
}

Client.prototype._log = function (who, args) {
  if (this.options.debugP) console.log(JSON.stringify({ who: who, what: args || {}, when: underscore.now() }, null, 2))
  if (this.options.loggingP) this.logging.push({ who: who, what: args || {}, when: underscore.now() })
}

Client.prototype._updateRules = function (callback) {
  var path
  var self = this

  self.state.rulesStamp = underscore.now() + msecs.hour
  if (self.options.verboseP) self.state.rulesDate = new Date(self.state.rulesStamp)

  path = '/v1/publisher/ruleset'
  self.roundtrip({ path: path, method: 'GET' }, function (err, response, ruleset) {
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

    self._updatePublishers(callback)
  })
}

Client.prototype._updatePublishers = function (callback) {
  var path
  var self = this

  self.state.rulesStamp = underscore.now() + msecs.hour
  if (self.options.verboseP) self.state.rulesDate = new Date(self.state.rulesStamp)

  path = '/v1/publisher/identity/verified'
  self.roundtrip({ path: path, method: 'GET' }, function (err, response, publishers) {
    self._log('_updatePublishers', { method: 'GET', path: '/v1/publisher/verified', errP: !!err })
    if (err) return callback(err)

    if (!util.isArray(publishers)) {
      self._log('_updatePublishers', { error: 'not an array' })
      return callback(new Error('not an array'))
    }

    self.state.verifiedPublishers = publishers || []

    self.state.rulesStamp = underscore.now() + (self.options.debugP ? msecs.hour : msecs.day)
    if (self.options.verboseP) self.state.rulesDate = new Date(self.state.rulesStamp)
    callback()
  })
}

// round-trip to the ledger
Client.prototype._roundTrip = function (params, callback) {
  var self = this

  var request, timeoutP
  var client = self.options.server.protocol === 'https:' ? https : http

  params = underscore.extend(underscore.pick(self.options.server, [ 'protocol', 'hostname', 'port' ]), params)
  params.headers = underscore.defaults(params.headers || {},
                                       { 'content-type': 'application/json; charset=utf-8', 'accept-encoding': '' })

  request = client.request(underscore.omit(params, [ 'useProxy', 'payload' ]), function (response) {
    var body = ''

    if (timeoutP) return
    response.on('data', function (chunk) {
      body += chunk.toString()
    }).on('end', function () {
      var payload

      if (params.timeout) request.setTimeout(0)

      if (self.options.verboseP) {
        console.log('[ response for ' + params.method + ' ' + self.options.server.protocol + '//' +
                    self.options.server.hostname + params.path + ' ]')
        console.log('>>> HTTP/' + response.httpVersionMajor + '.' + response.httpVersionMinor + ' ' + response.statusCode +
                   ' ' + (response.statusMessage || ''))
        underscore.keys(response.headers).forEach(function (header) {
          console.log('>>> ' + header + ': ' + response.headers[header])
        })
        console.log('>>>')
        console.log('>>> ' + body.split('\n').join('\n>>> '))
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

      try {
        callback(null, response, payload)
      } catch (err0) {
        if (self.options.verboseP) console.log('callback: ' + err0.toString() + '\n' + err0.stack)
      }
    }).setEncoding('utf8')
  }).on('error', function (err) {
    callback(err)
  }).on('timeout', function () {
    timeoutP = true
    callback(new Error('timeout'))
  })
  if (params.payload) request.write(JSON.stringify(params.payload))
  request.end()

  if (!self.options.verboseP) return

  console.log('<<< ' + params.method + ' ' + params.protocol + '//' + params.hostname + params.path)
  underscore.keys(params.headers).forEach(function (header) { console.log('<<< ' + header + ': ' + params.headers[header]) })
  console.log('<<<')
  if (params.payload) console.log('<<< ' + JSON.stringify(params.payload, null, 2).split('\n').join('\n<<< '))
}

/*
 *
 * utilities
 *
 */

Client.prototype.boolion = function (value) {
  var f = {
    undefined: function () {
      return false
    },

    boolean: function () {
      return value
    },

    // handles `Infinity` and `NaN`
    number: function () {
      return (!!value)
    },

    string: function () {
      return ([ 'n', 'no', 'false', '0' ].indexOf(value.toLowerCase()) === -1)
    },

    // handles `null`
    object: function () {
      return (!!value)
    }
  }[typeof value] || function () { return false }

  return f()
}

Client.prototype.numbion = function (value) {
  if (typeof value === 'string') value = parseInt(value, 10)

  var f = {
    undefined: function () {
      return 0
    },

    boolean: function () {
      return (value ? 1 : 0)
    },

    // handles `Infinity` and `NaN`
    number: function () {
      return (Number.isFinite(value) ? value : 0)
    },

    object: function () {
      return (value ? 1 : 0)
    }
  }[typeof value] || function () { return 0 }

  return f()
}

module.exports = Client
