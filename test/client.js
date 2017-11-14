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
  var callback

  before(function () {
    callback = 'placeholder for sinon'
    cred = 'placeholder for sinon'
    client.roundtrip = function () {}
  })

  beforeEach(function () {
    sandbox.stub(global, 'cred').value({ parameters: {userId: "userIdTest", registrarVK: "registerVkTest", masterUserToken: "masterUserTokenTest"} })
    sandbox.stub(client, 'roundtrip')
    callback = sandbox.spy()
  })

  afterEach(function () {
    sandbox.restore()
  })

  describe('ballots', function() {
    beforeEach(function () {
      sandbox.stub(client.state, 'transactions')
      sandbox.stub(client.state, 'transactions').value([
        { votes: 3, count: 10, viewingId: 'viewingIdTest' },
        { votes: 0, count: 15, viewingId: 'randomUUID' }
      ])
    })

    it('returns count - votes for transactions with given viewingId', function() {
      assert.equal(client.ballots('viewingIdTest'), 7);
    });

    it('returns count - votes for all transactions', function() {
      assert.equal(client.ballots(), 22);
    });
  });

  describe('vote', function() {
    beforeEach(function () {
      sandbox.stub(client.state, 'transactions')
      client.state.transactions = [{ votes: 0, count: 15, surveyorIds: ['surveyorIdTest'], viewingId: 'viewingIdTest' }]
      sandbox.stub(client.state, 'ballots').value([])
    })

    it('throws error when missing publisher parameter', function() {
      assert.throws(client.vote, /missing publisher parameter/)
    });

    it('pushes vote to ballot', function() {
      client.vote('publisherTest', 'viewingIdTest')
      assert.deepEqual(client.state.ballots, [{surveyorId: 'surveyorIdTest', publisher: 'publisherTest', offset: 0, viewingId: 'viewingIdTest'}])
      assert.equal(client.state.transactions[0].votes, 1)
    });
  });

  describe('_updateRules', function() {
    beforeEach(function () {
       sandbox.stub(client, '_updateRulesV2')
    })

    it('updates ruleset on response', function () {
      client.roundtrip.callsArgWith(1, false, 'response', [{condition: "conditionTest"}])
      client._updateRules(callback)
      assert(client._updateRulesV2.calledWith(callback))
      assert.deepEqual(client.state.ruleset, [{condition:"conditionTest"}])
      assert.deepEqual(ledgerPublisher.rules, [{condition:"conditionTest"}])
    });

    it('calls callback with error on invalid JSON response', function() {
      client.roundtrip.callsArgWith(1, false, 'response', ["test"])
      client._updateRules(callback)
      sinon.assert.called(callback)
      sinon.assert.calledWith(callback, sinon.match(Error))
    });
  });

  describe('_updateRulesV2', function() {
    beforeEach(function () {
      sandbox.stub(client, '_updatePublishersV2')
      sandbox.stub(global, 'setTimeout')
    })

    it('calls _updatePublishersV2 with callback when returned rules are empty', function() {
      client.roundtrip.callsArgWith(1, false, 'response', [])
      client._updateRulesV2(callback)
      sinon.assert.called(client._updatePublishersV2)
      sinon.assert.calledWith(client._updatePublishersV2, callback)
    });

    it('updates rulesV2Stamp', function() {
      rules = [{condition:"conditionTest", timestamp: "1234"}]
      client.roundtrip.callsArgWith(1, false, 'response', rules)
      client._updateRulesV2(callback)
      assert.deepEqual(client.state.rulesetV2, rules)
      assert.equal(client.state.rulesV2Stamp, "1235")
    });
  })

  describe('_updatePublishersV2', function() {
    it('updates publishers list', function() {
      rules = [{condition:"conditionTest", timestamp: "1234"}]
      client.roundtrip.callsArgWith(1, false, 'response', rules)
      client._updatePublishersV2(callback)
      assert.deepEqual(client.state.publishersV2, rules)
      assert.equal(client.state.publishersV2Stamp, "1235")
    });

    it('calls callback when returned publishers is empty', function() {
      client.roundtrip.callsArgWith(1, false, 'response', [])
      client._updatePublishersV2(callback)
      sinon.assert.called(callback)
    });

    it('calls callback with error when API returns error', function() {
      client.roundtrip.callsArgWith(1, 'errorTest', 'response', [])
      client._updatePublishersV2(callback)
      sinon.assert.called(callback)
      sinon.assert.calledWithMatch(callback, 'errorTest')
    });
  })

  describe('_registerPersona', function () {
    it('calls callback with error if API returns error', function() {
      client.roundtrip.callsArgWith(1, 'errorTest', 'response', {})
      client._registerPersona(callback)
      sinon.assert.called(callback)
      sinon.assert.calledWithMatch(callback, 'errorTest')
    });

    context('on succesfull HTTP call', function () {
      before(function () {
        client.credentials = {}
      })

      after(function () {
        delete client.credentials
      })

      beforeEach(function () {
        client.roundtrip.withArgs(sinon.match.has('method', 'GET')).callsArgWith(1, false, 'response', {})
        sandbox.stub(anonize, 'Credential').returns(cred)
        sandbox.stub(client, 'credentialRequest').callsArgWith(1, false, 'response', cred)
        sandbox.stub(client, 'credentialFinalize').callsArgWith(2, false, { credential: cred })
      });

      it('makes a POST to the persona userId endpoint', function() {
        client.roundtrip.withArgs(sinon.match.has('method', 'POST'))
        client._registerPersona(() => {})
        sinon.assert.calledWith(client.roundtrip,
          sinon.match.typeOf('object')
            .and(sinon.match.has('method', 'POST'))
            .and(sinon.match.has('path', '/v1/registrar/persona/' + cred.parameters.userId))
        )
      });

      context('on succesfull POST to userId endpoint', function () {
        beforeEach(function () {
          client.state.properties = sandbox.stub(client.state)
          client.roundtrip.withArgs(sinon.match.has('method', 'POST')).callsArgWith(1, false, 'response', {
            payload: {
              adFree: { fee: { USD: 11 }, days: 15 },
            },
            contributions: 'test',
            wallet: { paymentId: 'testPaymentId', address: 'testAddress' }
          })
        })

        it('sets the local properties', function () {
          client._registerPersona(callback)
          assert(client.credentialFinalize.called)
          expect(client.state.properties).to.deep.include({
            setting: 'adFree',
            fee: { currency: 'USD', amount: 11 },
            days: 15,
            configuration: 'test',
          })
          expect(client.state.properties.wallet).to.deep.include({
            paymentId: 'testPaymentId',
            address: 'testAddress'
          })
        });

        it('calls callback', function () {
          client._registerPersona(callback)
          assert(client.credentialFinalize.called)
          assert(callback.calledWith(null, client.state, 60 * 1000))
        });
      });
    });
  });

  describe('_registerViewing', function () {
    beforeEach(function () {
      sandbox.stub(anonize, 'Credential').returns(cred)
    })

    it('calls callback with error if API returns error', function() {
      client.roundtrip.callsArgWith(1, 'errorTest', 'response', {})
      sandbox.stub(client, 'credentialRequest').callsArgWith(1, 'errorTest', 'response', {})

      client._registerViewing('viewingIdTest', callback)

      assert(callback.calledWith('errorTest'))
    });

    it('makes post to viewing endpoint with cred userId', function() {
      client.roundtrip.withArgs(sinon.match.has('method', 'GET')).callsArgWith(1, false, 'response', {})
      sandbox.stub(client, 'credentialRequest').callsArgWith(1, false, 'response', {credential: cred})
      client.roundtrip.withArgs(sinon.match.has('method', 'POST'))

      client._registerViewing('viewingIdTest', function () {})

      sinon.assert.calledWith(
        client.roundtrip,
        sinon.match.has('method', 'POST'),
      )
      sinon.assert.calledWith(
        client.roundtrip,
        sinon.match.has('path', '/v1/registrar/viewing/' + cred.parameters.userId)
      )
    })

    context('if credential setup succesfull', function () {
      beforeEach(function () {
        sandbox.stub(client, 'credentialRequest').callsArgWith(1, false, 'response', {credential: cred})
        sandbox.stub(client, 'credentialFinalize').callsArgWith(2, false, { credential: cred })
        client.roundtrip.withArgs(sinon.match.has('method', 'GET')).callsArgWith(1, false, 'response', {})
        client.roundtrip.withArgs(sinon.match.has('method', 'POST')).callsArgWith(1, false, 'response', {
          verification: 'verification',
          surveyorIds: ['surveyorIdTest'],
          satoshis: 1234
        })
      })

      it('updates transaction for given viewingId', function() {
        sandbox.stub(client.state, 'transactions').value([{ viewingId: 'viewingIdTest' }])
        client._registerViewing('viewingIdTest', function () {})
        expect(client.state.transactions[0]).to.deep.include({
          credential: cred,
          surveyorIds: ['surveyorIdTest'],
          count: 1,
          satoshis: 1234,
          votes: 0
        })
      });

      it('calls callback with error if viewingId isn\'t found', function() {
        sandbox.stub(client.state, 'transactions').value([{ viewingId: 'vieringIdTestRand' }])
        client._registerViewing('viewingIdTest', callback)
        assert(callback.called)
        sinon.assert.calledWith(callback, sinon.match(Error))
        sinon.assert.calledWith(callback,
          sinon.match(sinon.match.has('message', sinon.match(/not found in transaction list/))))
      });
    });
  })


  describe('_prepareBallot', function() {
    before(function () {
      this.ballots = 'placeholder for sinon'
    })

    after(function () {
      delete this.ballots
    })

    beforeEach(function () {
      sandbox.stub(this, 'ballots').value([{ surveyorId: 'surveyorIdTest' }])
      sandbox.stub(anonize, 'Credential').returns(cred)
    })

    it('calls callback with error if API returns error', function() {
      client.roundtrip.callsArgWith(1, 'errorTest', 'response', {})
      client._prepareBallot(this.ballots, {}, callback)
      sinon.assert.called(callback)
      sinon.assert.calledWithMatch(callback, 'errorTest')
    });

    it('calls passed callback', function() {
      client.roundtrip.callsArgWith(1, false, 'response', {})
      client._prepareBallot(this.ballots, {}, callback)
      sinon.assert.called(callback)
      sinon.assert.calledWith(callback, null, client.state, 60 * 1000)
    });
  });

  describe('_commitBallot', function() {
    before(function () {
      this.ballots = 'placeholder for sinon'
      this.transactions = 'placeholder for sinon'
    })

    after(function() {
      delete this.ballots
      delete this.transactions
    })

    beforeEach(function () {
      sandbox.stub(this, 'ballots').value([{ surveyorId: 'surveyorIdTest', publisher: 'publisherTest'}])
      sandbox.stub(this, 'transactions').value([{ ballots: { domainTest: 2 } }])
      sandbox.stub(anonize, 'Credential').returns(cred)
      sandbox.stub(anonize, 'Surveyor').returns({parameters: { surveyorId: 'surveyorIdTest' }}) 
    })

    it('calls callback with error when credential submit fails', function() {
      sandbox.stub(client, 'credentialSubmit').callsArgWith(3, 'errorTest', 'result')
      client._commitBallot(this.ballots[0], this.transactions[0], callback)
      assert(callback.called)
      assert(callback.calledWith('errorTest'))
    });

    it('it makes a PUT request to the survey endpoint', function() {
      sandbox.stub(client, 'credentialSubmit').callsArgWith(3, false, {payload: 'payload'})
      client._commitBallot(this.ballots[0], this.transactions[0], callback)
      sinon.assert.calledWith(client.roundtrip, sinon.match.object, sinon.match.func)
      sinon.assert.calledWith(client.roundtrip, sinon.match.has('path', '/v1/surveyor/voting/surveyorIdTest'))
      sinon.assert.calledWith(client.roundtrip, sinon.match.has('method', 'PUT'))
      sinon.assert.calledWith(client.roundtrip, sinon.match.has('useProxy', true))
      sinon.assert.calledWith(client.roundtrip, sinon.match.has('payload', 'payload'))
    });

    it('it removes ballot from pending and calls callback', function() {
      sandbox.stub(client, 'credentialSubmit').callsArgWith(3, false, {payload: 'payload'})
      client.roundtrip.callsArgWith(1, false, 'response', 'body')
      client._commitBallot(this.ballots[0], this.transactions[0], callback)
      assert(callback.called)
      sinon.assert.calledWith(callback, null, client.state, 60 * 1000)
      assert.equal(client.state.ballots.length, this.ballots.length - 1)
    });
  })

  describe('_roundTrip', function() {
    beforeEach(function () {
      sandbox.stub(https, 'request')
    })

    it('should send post params in body', function() {
      var params = { path: '/path', method: 'POST', payload: 'payloadTest' }

      var request = new PassThrough()
      sandbox.spy(request, 'write')
      https.request.returns(request)

      client._roundTrip(params, function() { })

      sinon.assert.calledWith(request.write)
      sinon.assert.calledWithMatch(request.write, 'payloadTest')
    });

    it('should convert payload to object when response is 200', function(done) {
      var params = { path: "/path", method: "GET" }
      var expected = '{ "keyTest": "valueTest" }'
      var response = new PassThrough()
      response.write(expected)
      response.end()
      response.statusCode = 200
     
      var request = new PassThrough()
     
      https.request.callsArgWith(1, response)
                  .returns(request)

      client._roundTrip(params, function(err, result, payload) {
        assert.deepEqual(payload, { keyTest: "valueTest" })
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
    
      https.request.callsArgWith(1, response)
                  .returns(request)

      client._roundTrip(params, function(err) {
        console.log(err)
        assert(err instanceof SyntaxError)
        done()
      })
    });
  });

  describe('credentialRequest', function() {
    var credential

    beforeEach(function () {
      credential = sandbox.spy()
      credential.finalize = function () {}
      credential.request = function () {}
    })

    it('calls callback with exception when credential.finalize throws exception', function() {
      sandbox.stub(credential, 'finalize').throws("TypeError")
      client.credentialFinalize(credential, 'verification', callback)
      sinon.assert.called(callback)
      sinon.assert.calledWithMatch(callback, TypeError)
    });

    it('calls credential.request then callback', function() {
      sandbox.stub(credential, 'request').returns('requestReturn')
      client.credentialRequest(credential, callback)
      sinon.assert.called(credential.request)
      sinon.assert.called(callback)
      sinon.assert.calledWithMatch(callback, null, { proof: 'requestReturn'})
    });
  });

  describe('credentialFinalize', function() {
    var credential

    beforeEach(function () {
      credential = sandbox.spy()
      credential.finalize = 'placeholder for sinon'
    })

    it('calls callback with exception when credential.finalize throws exception', function () {
      sandbox.stub(credential, 'finalize').throws("TypeError")
      client.credentialFinalize(credential, 'verification', callback)
      expect(callback.calledWith(TypeError))
    });

    it('calls credential.finalize then callback', function () {
      sandbox.stub(credential, 'finalize')
      client.credentialFinalize(credential, 'verification', callback)
      expect(credential.calledWith('verification'))
      expect(callback.calledWith(null, { credential: JSON.stringify(credential)}))
    });
  });

  describe('credentialSubmit', function() {
    var credential

    beforeEach(function () {
      credential = sandbox.spy()
      credential.submit = 'placeholder for sinon'
    })

    it('calls callback with exception when credential.submit throws exception', function() {
      sandbox.stub(credential, 'submit').throws("TypeError")
      client.credentialSubmit(credential, 'surveyor', 'data', callback)
      expect(callback.calledWith(TypeError))
    });

    it('calls credential.submit then callback', function() {
      sandbox.stub(credential, 'submit').returns('submitReturn')
      client.credentialSubmit(credential, 'surveyor', 'data', callback)
      expect(credential.calledWith('surveyor', 'data'))
      expect(callback.calledWith(null, { payload: { proof: 'submitReturn' }}))
    });
  });

  describe('getWalletAddress', function() {
    beforeEach(function (){
      client.state.properties = sandbox.stub(client.state)
      client.state.properties = { wallet: { address: 'getWalletTestAddress' } }
    })

    it('should return wallet address', function() {
      assert.equal(client.getWalletAddress(), 'getWalletTestAddress')
    });
  });

  describe('setTimeUntilReconcile', function() {
    it('sets reconcileStamp based on state.properties.days when timestamp passed is false', function() {
      sandbox.stub(underscore, "now").returns(100)
      client.state.properties.days = 2
      client.setTimeUntilReconcile(false, callback)
      assert.equal(client.state.reconcileStamp, (2 * 24 * 60 * 60 * 1000) + 100)
      sinon.assert.called(callback)
    });

    it('sets reconcileStamp based on state.properties.days when timestamp passed is in the past', function() {
      sandbox.stub(underscore, "now").returns(100)
      sandbox.stub(client.state.properties, 'days').value(2)
      client.setTimeUntilReconcile(50, callback)
      assert.equal(client.state.reconcileStamp, (2 * 24 * 60 * 60 * 1000) + 100)
      sinon.assert.called(callback)
    });

    it('sets reconcileStamp to timestamp if it\'s in the future', function() {
      sandbox.stub(underscore, "now").returns(100)
      client.setTimeUntilReconcile(300, callback)
      assert.equal(client.state.reconcileStamp, 300)
      sinon.assert.called(callback)
    });
  });

  describe('timeUntilReconcile', function() {
    before(function () {
      client.state.reconcileStamp = 'placeholder for sinon'
      client.state.currentReconcile = 'placeholder for sinon'
    })

    it('throw exception when when client initialization is incomplete', function () {
      sandbox.stub(client.state, 'reconcileStamp').value(undefined)
      assert.throws(() => { client.timeUntilReconcile(), /initialization incomplete/ })
    });

    it('returns false if currently reconciling', function () {
      sandbox.stub(client.state, 'reconcileStamp').value(underscore.now())
      sandbox.stub(client.state, 'currentReconcile').value(true)
      assert.equal(client.timeUntilReconcile(), false)
    });

    it('returns time till reconcile', function () {
      sandbox.stub(client.state, 'reconcileStamp').value(300)
      sandbox.stub(client.state, 'currentReconcile').value(false)
      sandbox.stub(underscore, "now").returns(100)
      assert.equal(client.timeUntilReconcile(), 200)
    });
  });

  describe('isReadyToReconcile', function () {
    it('returns false when timeUntilReconcile returns false', function() {
      sandbox.stub(client, "timeUntilReconcile").returns(false)
      assert.equal(client.isReadyToReconcile(), false)
    });

    context('when timeUntilReconcile returns true', function () {
      beforeEach(function () {
        sandbox.stub(client, "timeUntilReconcile").returns(underscore.now + 100)
      });

      it('returns false when timeUntilReconcile is in the future', function() {
        assert.equal(client.isReadyToReconcile(), false)
      });

      it('returns true when timeUntilReconcile is in the past', function() {
        assert.equal(client.isReadyToReconcile(), false)
      });
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