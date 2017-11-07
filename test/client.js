var chai = require('chai');
var assert = require('assert');
var sinon = require('sinon');
var url = require('url');
var underscore = require('underscore');

expect = chai.expect


var server = url.parse('https://localhost')
var options = { server: server, debugP: false, loggingP: false, verboseP: false }
var client = require('../index.js')("7c5d8057-cbd9-48dd-9c87-af04f77e571a", options, {});

describe('client', function() {

  var p = {"wallet":{"paymentId":"539309ec-5298-4329-a867-51ece5f48804","address":"2My6v9BsuD5Q9pgs5JbTzN7rZemdwhmRiMN"},"payload":{"adFree":{"fee":{"USD":5},"days":30}},"verification":"7RpfGPgOA7Fd6WP+E/rHiEZ4EL37CPlYk/Yu1NramV 4N9K3/qrTtazwdkOUmTVSogYNNy2axMz+tQOKqn+0MS 1 9XWaN9hVivRUASP3dx+EqZLC5BkQV3GRepMRSaJkz+8\n"}
  client.state.properties = p

  describe('getWalletAddress', function() {
    it('should return wallet address', function() {
      assert.equal(client.getWalletAddress(), p.wallet.address);
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