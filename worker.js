/* jshint asi: true, node: true, laxbreak: true, laxcomma: true, undef: true, unused: true */
/* global define, self */

define([ 'console' ], function (console) {
console.log('hello worker')
var anonize = require('node-anonize2-relic-emscripten/index.js')
console.log('anonize loaded')

self.onmessage = function (request) {
  var d = function (err, result) {
    self.postMessage({ msgno: request.msgno, err: err, result: result })
  }

  var f = {
    request:
      function () {
        var credential = new anonize.Credential(request.payload.credential)
        var proof = credential.request()

        return { credential: JSON.stringify(credential), proof: proof }
      },

    finalize:
      function () {
        var credential = new anonize.Credential(request.payload.credential)

        credential.finalize(request.payload.verification)
        return { credential: JSON.stringify(credential) }
      },

    submit:
      function () {
        var credential = new anonize.Credential(request.payload.credential)
        var surveyor = new anonize.Surveyor(request.payload.surveyor)

        return { payload: { proof: credential.submit(surveyor, request.payload.data) } }
      }
  }[request.operation]
  if (!f) return d('invalid operation')

  try {
    d(null, f())
  } catch (ex) {
    d(ex.toString())
  }
}
})
