var anonize = require('node-anonize2-relic-emscripten')
var chai = require('chai');
var Joi = require('joi')
var http = require('http');
var https = require('https');
var assert = require('assert');
var sinon = require('sinon');
var PassThrough  = require('stream').PassThrough;
var url = require('url');
var underscore = require('underscore');
var ledgerPublisher = require('ledger-publisher')

expect = chai.expect


var server = url.parse('https://localhost')
var options = { server: server, debugP: false, loggingP: false, verboseP: false }
var client = require('../index.js')("7c5d8057-cbd9-48dd-9c87-af04f77e571a", options, {});
var sandbox = sinon.createSandbox();

describe('client', function() {

  var p = {"wallet":{"paymentId":"539309ec-5298-4329-a867-51ece5f48804","address":"2My6v9BsuD5Q9pgs5JbTzN7rZemdwhmRiMN"},"payload":{"adFree":{"fee":{"USD":5},"days":30}},"verification":"7RpfGPgOA7Fd6WP+E/rHiEZ4EL37CPlYk/Yu1NramV 4N9K3/qrTtazwdkOUmTVSogYNNy2axMz+tQOKqn+0MS 1 9XWaN9hVivRUASP3dx+EqZLC5BkQV3GRepMRSaJkz+8\n"}
  client.state.properties = p

  var viewingId1 = "4f3067eb-1156-4bac-b604-1c2214bf4ce2"
  var viewingId2 = "3de7feb8-63cc-4dd5-a3bd-b0aa67c6f180"
  var surveyorIds1 = ["7qgfSlOmypD0RuFUfBEEZ/m98YvC/6+1etWd5dUlko+"]
  var surveyorIds2 = ["7qgfSlOmypD0RuFUfBEEZ/m98YvC/6+1etWd5dUlko+"]

  var mockCredParameters = {"userId": "dd85ff07748142aa77acd545357ad40", "registrarVK": "==========ANONLOGIN_VK_BEG==========\\n8qSzvRre6Ctso8z4wHJH/20YQ70v2DAWeYzsmv6RKVr 2AVAyqqlat/yboyKhWhqHi5Oah/MBQOlhPtke7vZyZ7 1\\nAZirScmoBKMo4izS7nNQ2+NS3LEc45oB3OHf8cQDp9G 5AZV4BCwzAKaczSV8fVV8CgrcT49aQOOmbPLKPuFlFv 1\\n7TFr0dF/HoV0UyOSLzrER912BAbZ5HGZE2sQLnpKK3V 8RS8XL4j39Bncugkgt/n/6hOmwupapZlPPC+QlR+nDT 1\\nApWlU7Dr3YvU/q0GcQWcpN4/mKKDVxe3nw7EckIdexm Aig/OjtTPALgUIWgaDf4UCYIh6yOEDpu6tnaUAcP79t 1\\nAPTGi8GzVp/v7f8SjUxWOM8ZQ4MlxFg4oLChkEb/4H3 4sTlMQWQrDTy9eelR8k21BfPdfQplYVHealj92oVgj6 9K7kkJi2jZetyDaSHBG0+xnAfYD2q6x3zzCsyhAQA6A 7EFPVRUXw+3H+OD7vhQ2gwknJw7prJZ/G6njidv18QS 1 0\\n===========ANONLOGIN_VK_END==========", masterUserToken: "==========ANONLOGIN_CRED_BEG==========\\ndd85ff07748142aa77acd545357ad40\\n9wQhO2Oc5/K1gZ+w9+c3j1lu6z7NVpfAT4a6dgXYlnO\\n5pAHJn0+lAx9h5V9Ezom0MeUKx9ulG8hkdAz9OradGd 5lJaAWnjBtYtaaNoU93Uiij2eUelBcsU4XbsIQ3IjgJ 1\\n14+2ID681khx4rwmoQBmPGK+lrTkdudXgaOdsSNy/QN\\nCkAhjw3GS4k10ftLysqDgP1k4yZMXD0rXBxJoa8IfkP\\n===========ANONLOGIN_CRED_END=========="}
  var mockCred = {"parameters": underscore.clone(mockCredParameters) }

  var mockTransactions = [{
      viewingId: viewingId1,
      surveyorIds: surveyorIds1,
      contribution: { fiat: { amount: 50, currency: "BAT" },
        rates: 0.0004724924142289473,
        satoshis: 0.00002123,
        fee: 0.15491044219204892
      },
      ballots: {
        "wikipedia.com": 3,
      },
      votes: 3,
      count: 10,
      submissionStamp: 9481492768539,
      credential: underscore.clone(mockCredParameters)
    },
    {
      viewingId: viewingId2,
      surveyorIds: surveyorIds2,
      votes: 0,
      count: 15,
      ballots: {
        "wikipedia.com": 4,
      },
      contribution: { fiat: { amount: 50, currency: "BAT" },
        rates: 0.0004724924142282941,
        satoshis: 0.00002195,
        fee: 0.154910442192194832
      },
      submissionStamp: 9481492764931,
      credential: underscore.clone(mockCredParameters)
    }
  ]


  mockBallots = [{
    viewingId: '1f0e8dc1-382a-4697-880c-a6d175f36be2',
    surveyorId: surveyorIds1,
    publisher: 'wikipedia.com',
    offset: 2
  }]


  describe('ballots', function() {
    beforeEach(function () {
      viewingId = 'd1f36028-4310-4d52-8dd7-c3e50ceddb93'
      clientStateTransactions = sinon.stub(client.state, 'transactions')
      client.state.transactions = [
        { votes: 3, count: 10, viewingId: viewingId },
        { votes: 0, count: 15, viewingId: 'randomUUID' }
      ]
    })

    it('returns count - votes for transactions with given viewingId', function() {
      assert.equal(client.ballots(viewingId), 7);
    });

    it('returns count - votes for all transactions', function() {
      assert.equal(client.ballots(), 22);
    });

    afterEach(function () {
      clientStateTransactions.restore()
      delete viewingId
    })
  });


  describe('vote', function() {
    beforeEach(function () {
      viewingId = 'd1f36028-4310-4d52-8dd7-c3e50ceddb93'
      surveyorId = '2a699d6d-49d7-4ebd-a8f5-33cb5ed4fc99'
      clientStateTransactions = sinon.stub(client.state, 'transactions')
      client.state.transactions = [
        { votes: 0, count: 15, surveyorIds: [surveyorId], viewingId: viewingId }
      ]
      clientStateBallots = sinon.stub(client.state, 'ballots')
      client.state.ballots = []
    })

    it('throws error when missing publisher parameter', function() {
      assert.throws(client.vote, /missing publisher parameter/)
    });

    it('pushes vote to ballot', function() {
      var publisher = 'wikipedia.com'
      client.vote(publisher, viewingId)
      assert.deepEqual(client.state.ballots, [{surveyorId: surveyorId, publisher: publisher, offset: 0, viewingId: viewingId}])
      assert.equal(client.state.transactions[0].votes, 1)
    });

    afterEach(function () {
      clientStateTransactions.restore()
      clientStateBallots.restore()
      delete viewingId
      delete surveyorId
    })
  });


  describe('_updateRules', function() {
    beforeEach(function () {
      client._updateRulesV2 = sinon.stub()
    })

    it('updates ruleset on response', function() {
      client.state.ruleset = ''
      ledgerPublisher.rules = ''
      rules = [{condition:"(new Set([ \"baidu\"])"}]
      client.roundtrip = sinon.stub().callsArgWith(1, false, 'response', rules)

      callback = sinon.spy()
      client._updateRules(callback)

      assert(client._updateRulesV2.calledWith(callback))
      assert.equal(client.state.ruleset, rules)
      assert.equal(ledgerPublisher.rules, rules)
    });

    it('calls callback with error on invalid JSON response', function() {
      rules = ["test"]
      client.roundtrip = sinon.stub().callsArgWith(1, false, 'response', rules)

      callback = sinon.spy()
      client._updateRules(callback)

      assert(callback.called)
      console.log('calls: ' + callback.getCalls())
      sinon.assert.calledWith(callback, sinon.match(Error))
    });

    afterEach(function () {
      delete client._updateRulesV2
    })
  });

  describe('_updateRulesV2', function() {
    beforeEach(function () {
      client.state.rulesetV2 = undefined
      _updatePublishersV2 = sinon.stub(client, '_updatePublishersV2')
      sinon.stub(global, 'setTimeout')
    })

    it('calls _updatePublishersV2 with callback when returned rules are empty', function() {
      rules = []
      client.roundtrip = sinon.stub().callsArgWith(1, false, 'response', rules)

      client._updateRulesV2('callback')

      assert(_updatePublishersV2.calledWith('callback'))
      delete client.roundtrip
    });

    it('updates rulesV2Stamp', function() {
      rules = [{condition:"(new Set([ \"baidu\"])", timestamp: "6389310438928023553"}]
      client.roundtrip = sinon.stub().callsArgWith(1, false, 'response', rules)

      callback = sinon.spy()
      client._updateRulesV2(callback)

      assert.deepEqual(client.state.rulesetV2, rules)
      assert.equal(client.state.rulesV2Stamp, "6389310438928023554")
      delete client.roundtrip
    });

    afterEach(function () {
      _updatePublishersV2.restore()
      delete client.roundtrip
      global.setTimeout.restore()
    })
  })


  describe('_updatePublishersV2', function() {
    it('updates publishers list', function() {
      rules = [{condition:"(new Set([ \"baidu\"])", timestamp: "6389310438928023553"}]
      client.roundtrip = sinon.stub().callsArgWith(1, false, 'response', rules)

      spy = sinon.spy()
      client._updatePublishersV2(spy)

      assert.deepEqual(client.state.publishersV2, rules)
      assert.equal(client.state.publishersV2Stamp, "6389310438928023554")
      delete client.roundtrip
    });

    it('calls callback when returned publishers is empty', function() {
      rules = []
      client.roundtrip = sinon.stub().callsArgWith(1, false, 'response', rules)

      spy = sinon.spy()
      client._updatePublishersV2(spy)

      assert(spy.called)
      delete client.roundtrip
    });

    it('calls callback with error when API returns error', function() {
      rules = []
      client.roundtrip = sinon.stub().callsArgWith(1, 'test error', 'response', rules)

      spy = sinon.spy()
      client._updatePublishersV2(spy)

      assert(spy.calledWith('test error'))
      delete client.roundtrip
    });
  })

  describe('_registerViewing', function() {
    beforeEach(function () {
      sandbox.stub(mockCred)
      clientStateTransactions = sinon.stub(client.state, 'transactions')
      viewingId = 'c9190824-410a-40a8-82e4-f72f427bb23a'
      sandbox.stub(client.state.transactions)
      client.state.transactions = [
        { viewingId: viewingId }
      ]
      anonizeCredential = sinon.stub(anonize, 'Credential').returns(mockCred)
    })

    it('calls callback with error if API returns error', function() {
      client.roundtrip = sinon.stub().callsArgWith(1, 'test error', 'response', {})
      credentialRequest = sinon.stub(client, 'credentialRequest').callsArgWith(1, 'test error', 'response', {})

      callback = sinon.spy()
      client._registerViewing(viewingId, callback)

      assert(callback.calledWith('test error'))
      credentialRequest.restore()
      delete client.roundtrip
    });

    it('makes post to viewing endpoint with cred userId', function() {
      client.roundtrip = sinon.stub()
      client.roundtrip.withArgs(sinon.match.has('method', 'GET')).callsArgWith(1, false, 'response', {})
      var credentialRequest = sinon.stub(client, 'credentialRequest').callsArgWith(1, false, 'response', {credential: mockCred})
      client.roundtrip.withArgs(sinon.match.has('method', 'POST'))

      callback = sinon.spy()
      client._registerViewing(viewingId1, callback)

      sinon.assert.calledWith(
        client.roundtrip,
        sinon.match.has('method', 'POST'),
      )
      sinon.assert.calledWith(
        client.roundtrip,
        sinon.match.has('path', '/v1/registrar/viewing/' + mockCred.parameters.userId)
      )

      credentialRequest.restore()
      delete client.roundtrip
    })

    it('updates transaction for given viewingId', function() {
      var mockSurveyorIds = ['mockSurveyId']
      var mockSatoshis = 2342

      client.roundtrip = sinon.stub()
      client.roundtrip.withArgs(sinon.match.has('method', 'GET')).callsArgWith(1, false, 'response', {})
      var credentialRequest = sinon.stub(client, 'credentialRequest').callsArgWith(1, false, 'response', {credential: mockCred})
      client.roundtrip.withArgs(sinon.match.has('method', 'POST')).callsArgWith(1, false, 'response', {
        verification: 'verification',
        surveyorIds: mockSurveyorIds,
        satoshis: mockSatoshis
      })
      var credentialFinalize = sinon.stub(client, 'credentialFinalize').callsArgWith(2, false, { credential: mockCred })


      var callback = sinon.spy()
      client._registerViewing(viewingId, callback)
      expect(client.state.transactions[0]).to.include(
        {
          credential: mockCred,
          surveyorIds: mockSurveyorIds,
          count: mockSurveyorIds.length,
          satoshis: mockSatoshis,
          votes: 0
        })

      credentialRequest.restore()
      delete client.roundtrip
      credentialFinalize.restore()
    });

    afterEach(function () {
      clientStateTransactions.restore()
      anonizeCredential.restore()
      sandbox.restore()
      delete viewingId
      delete surveyorId
    })
  })


  describe('_prepareBallot', function() {
    beforeEach(function () {
      sandbox.stub(mockBallots)
      sandbox.stub(mockTransactions)
      clientTransactions = sinon.stub(client.state, 'transactions')
    })

    it('calls callback with error if API returns error', function() {
      client.roundtrip = sinon.stub().callsArgWith(1, 'test error', 'response', {})

      var spy = sinon.spy()
      client._prepareBallot(mockBallots[0], mockTransactions[0], spy)

      assert(spy.calledWith('test error'))
      delete client.roundtrip
    });

    it('calls passed callback', function() {
      client.roundtrip = sinon.stub().callsArgWith(1, false, 'response', {})
      spy = sinon.spy()
      client._prepareBallot(mockBallots[0], mockTransactions[0], spy)

      sinon.assert.calledWith(spy, null, client.state, 60 * 1000)
      delete client.roundtrip
    });

    afterEach(function () {
      sandbox.restore()
      clientTransactions.restore()
    })
  })

  describe('_commitBallot', function() {
    beforeEach(function () {
      sandbox.stub(mockBallots)
      sandbox.stub(mockTransactions)
    })

    it('calls callback with error when credential submit fails', function() {
      surveyorId = "1babe30a-6b7c-400b-8bf1-a5cd847d02dd" 
      credentialSubmit = sinon.stub(client, 'credentialSubmit').callsArgWith(3, 'test error', 'result')

      surveyor = sinon.stub(anonize, 'Surveyor').returns({parameters: { surveyorId: surveyorId }}) 

      callback = sinon.spy()
      client._commitBallot(mockBallots[0], mockTransactions[0], callback)
      assert(callback.called)
      assert(callback.calledWith('test error'))

      credentialSubmit.restore()
      surveyor.restore()
    });

    it('it makes a PUT request to the survey endpoint', function() {
      surveyorId = "1babe30a-6b7c-400b-8bf1-a5cd847d02dd" 
      surveyor = sinon.stub(anonize, 'Surveyor').returns({parameters: { surveyorId: surveyorId }}) 
      credential = sinon.stub(anonize, 'Credential')

      credentialSubmit = sinon.stub(client, 'credentialSubmit').callsArgWith(3, false, {payload: 'payload'})
      client.roundtrip = sinon.stub()


      callback = sinon.spy()
      client._commitBallot(mockBallots[0], mockTransactions[0], callback)

      sinon.assert.calledWith(client.roundtrip, sinon.match.object, sinon.match.func)
      sinon.assert.calledWith(client.roundtrip, sinon.match.has('path', '/v1/surveyor/voting/' + surveyorId))
      sinon.assert.calledWith(client.roundtrip, sinon.match.has('method', 'PUT'))
      sinon.assert.calledWith(client.roundtrip, sinon.match.has('useProxy', true))
      sinon.assert.calledWith(client.roundtrip, sinon.match.has('payload', 'payload'))

      surveyor.restore()
      credential.restore()
      credentialSubmit.restore()
      delete client.roundtrip
    });

    it('it removes ballot from pending and calls callback', function() {
      surveyor = sinon.stub(anonize, 'Surveyor').returns({parameters: { surveyorId: surveyorIds2[0] }}) 
      credentialSubmit = sinon.stub(client, 'credentialSubmit').callsArgWith(3, false, {payload: 'payload'})
      client.roundtrip = sinon.stub().callsArgWith(1, false, 'response', 'body')

      callback = sinon.spy()
      client._commitBallot(mockBallots[0], mockTransactions[0], callback)

      assert.equal(client.state.ballots.length, mockBallots.length - 1)
      assert(callback.called)
      sinon.assert.calledWith(callback, null, client.state, 60 * 1000)

      surveyor.restore()
      credential.restore()
      credentialSubmit.restore()
      delete client.roundtrip
    });

    afterEach(function () {
      sandbox.restore()
    })
  })

  describe('_roundTrip', function() {
    beforeEach(function () {
      this.request = sinon.stub(https, 'request')
    });

    afterEach(function () {
      https.request.restore()
    });

    it('should send post params in body', function() {
      var params = { path: "/path", method: "POST", payload: "payload" }

      var request = new PassThrough()
      var write = sinon.spy(request, 'write')
      this.request.returns(request)

      client._roundTrip(params, function() { })

      assert(write.called)
      assert(write.calledWith(JSON.stringify(params.payload)))
    });

    it('should convert payload to object when response is 200', function(done) {
      var params = { path: "/path", method: "GET" }
      var expected = { testKey: 'testValue' }
      var response = new PassThrough()
      response.write(JSON.stringify(expected))
      response.end()
      response.statusCode = 200
     
      var request = new PassThrough()
     
      this.request.callsArgWith(1, response)
                  .returns(request)

      client._roundTrip(params, function(err, result, payload) {
        assert.deepEqual(payload, expected)
        done()
      })
    });

    it('should call callback with error if sent invalid JSON and not a 204 response', function(done) {
      var params = { path: "/path", method: "GET" }
      var expected = { testKey: 'testValue' }
      var response = new PassThrough()
      response.write('{asdf}')
      response.end()
      response.statusCode = 200
    
      var request = new PassThrough()
    
      this.request.callsArgWith(1, response)
                  .returns(request)

      client._roundTrip(params, function(err) {
        console.log(err)
        assert(err instanceof SyntaxError)
        done()
      })
    });
  });


  describe('credentialRequest', function() {
    it('calls callback with exception when credential.finalize throws exception', function() {
      credential = sinon.spy()
      callback = sinon.spy()
      credential.finalize = sinon.stub().throws("TypeError")
      client.credentialFinalize(credential, 'verification', callback)
      expect(callback.calledWith(TypeError))
    });

    it('calls credential.request then callback', function() {
      credential = sinon.spy()
      callback = sinon.spy()
      credential.request = sinon.stub().returns('requestReturn')
      client.credentialRequest(credential, callback)
      expect(credential.calledWith())
      expect(callback.calledWith(null, { proof: 'requestReturn'}))
    });
  });


  describe('credentialFinalize', function() {
    it('calls callback with exception when credential.finalize throws exception', function() {
      credential = sinon.spy()
      callback = sinon.spy()
      credential.finalize = sinon.stub().throws("TypeError")
      client.credentialFinalize(credential, 'verification', callback)
      expect(callback.calledWith(TypeError))
    });

    it('calls credential.finalize then callback', function() {
      credential = sinon.spy()
      callback = sinon.spy()
      credential.finalize = sinon.stub()
      client.credentialFinalize(credential, 'verification', callback)
      expect(credential.calledWith('verification'))
      expect(callback.calledWith(null, { credential: JSON.stringify(credential)}))
    });
  });

  describe('credentialSubmit', function() {
    it('calls callback with exception when credential.submit throws exception', function() {
      credential = sinon.spy()
      callback = sinon.spy()
      credential.submit = sinon.stub().throws("TypeError")
      client.credentialSubmit(credential, 'surveyor', 'data', callback)
      expect(callback.calledWith(TypeError))
    });

    it('calls credential.submit then callback', function() {
      credential = sinon.spy()
      callback = sinon.spy()
      credential.submit = sinon.stub().returns('submitReturn')
      client.credentialSubmit(credential, 'surveyor', 'data', callback)
      expect(credential.calledWith('surveyor', 'data'))
      expect(callback.calledWith(null, { payload: { proof: 'submitReturn' }}))
    });
  });


  describe('getWalletAddress', function() {
    it('should return wallet address', function() {
      assert.equal(client.getWalletAddress(), p.wallet.address)
    });
  });

  describe('setTimeUntilReconcile', function() {
    it('sets reconcileStamp based on state.properties.days when timestamp passed is false', function() {
      stub = sinon.stub(underscore, "now").returns(100)
      callback = sinon.spy()
      client.state.properties.days = 2
      client.setTimeUntilReconcile(false, callback)
      assert.equal(client.state.reconcileStamp, (2 * 24 * 60 * 60 * 1000) + 100)
      assert(callback.called)
      stub.restore()
    });

    it('sets reconcileStamp based on state.properties.days when timestamp passed is in the past', function() {
      stub = sinon.stub(underscore, "now").returns(100)
      callback = sinon.spy()
      client.state.properties.days = 2
      client.setTimeUntilReconcile(50, callback)
      assert.equal(client.state.reconcileStamp, (2 * 24 * 60 * 60 * 1000) + 100)
      assert(callback.called)
      stub.restore()
    });

    it('sets reconcileStamp to timestamp if it\'s in the future', function() {
      stub = sinon.stub(underscore, "now").returns(100)
      callback = sinon.spy()
      client.setTimeUntilReconcile(300, callback)
      assert.equal(client.state.reconcileStamp, 300)
      assert(callback.called)
      stub.restore()
    });
  });

  describe('timeUntilReconcile', function() {
    it('throw exception when when client initialization is incomplete', function() {
      client.state.reconcileStamp = undefined
      assert.throws(() => { client.timeUntilReconcile(), /initialization incomplete/ })
    });

    it('returns false if currently reconciling', function() {
      client.state.reconcileStamp = underscore.now()
      client.state.currentReconcile = true
      assert.equal(client.timeUntilReconcile(), false)
    });

    it('returns time till reconcile', function() {
      client.state.reconcileStamp = 300
      client.state.currentReconcile = false
      stub = sinon.stub(underscore, "now").returns(100)
      assert.equal(client.timeUntilReconcile(), 200)
      stub.restore()
    });
  });

  describe('isReadyToReconcile', function() {
    it('returns false when timeUntilReconcile returns false', function() {
      stub = sinon.stub(client, "timeUntilReconcile").returns(false)
      assert.equal(client.isReadyToReconcile(), false)
      stub.restore()
    });

    it('returns false when timeUntilReconcile is in the future', function() {
      stub = sinon.stub(client, "timeUntilReconcile").returns(underscore.now + 100)
      assert.equal(client.isReadyToReconcile(), false)
      stub.restore()
    });

    it('returns true when timeUntilReconcile is in the past', function() {
      stub = sinon.stub(client, "timeUntilReconcile").returns(underscore.now - 100)
      assert.equal(client.isReadyToReconcile(), false)
      stub.restore()
    });
  });

  describe('boolean', function() {
    it('returns false when argument is undefined', function() {
      assert.equal(client.boolion(undefined), false)
    });

    it('returns the same boolean when passed a boolean', function() {
      assert.equal(client.boolion(true), true)
      assert.equal(client.boolion(false), false)
    });

    it('returns a boolean for Infinity, NaN, and null', function() {
      assert.equal(client.boolion(Infinity), true)
      assert.equal(client.boolion(NaN), false)
      assert.equal(client.boolion(null), false)
    });

    it('returns false when passed a "false" string', function() {
      assert.equal(client.boolion('n'), false)
      assert.equal(client.boolion('no'), false)
      assert.equal(client.boolion('false'), false)
      assert.equal(client.boolion('0'), false)
    });
    // cover fallthrough?
  });

  describe('numbion', function() {
    it('returns an int when passed a string', function() {
      assert.equal(client.numbion('243'), 243)
    });

    it('returns 0 when passed undefined', function() {
      assert.equal(client.numbion(undefined), 0)
    });

    it('returns 1 or 0 when passed a boolean', function() {
      assert.equal(client.numbion(true), 1)
      assert.equal(client.numbion(false), 0)
    });

    it('returns 0 when passed a Infinity or NaN', function() {
      assert.equal(client.numbion(Infinity), 0)
      assert.equal(client.numbion(NaN), 0)
    });

    it('evaluates truth when passed an object', function() {
      assert.equal(client.numbion(null), 0)
      // add object that evaluates to false here?
    });
    // cover fallthrough?
  });
});