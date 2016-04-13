# ledger-client
An example of client code for the [Brave ledger](https://github.com/brave/ledger).

## API

To begin:

- The client must maintain a secure, persistent storage in which it can store a JSON object.

- Some calls require a callback of the form:

        var callback = function (err, result, delayTime) { ... }

    When the callback is invoked,
if `err` is `null`, and `result` is not `null`, then `result` must be put into persistent storage.
(If `err` is `null`,
then the operation has succeeded,
regardless of whether `result` is defined or not.)

- The [Ledger protocol](https://github.com/brave/ledger/tree/master/documentation/Ledger-Principles.md)
requires that the client uses a pseudo-random delay be introduced at certain points during operations.
Accordingly,
if the `delayTime` parameter is defined,
then the client should wait at least `delayTime` milliseconds before making a call to

        client.sync(callback)

    There is no harm in retrying earlier,
but,
from the network's perspective,
it will be a no-op.

### Creating an Endpoint

        var client = require('ledger-client')
        this.client = new client(personaId, options, state, callback)

where the value for `personaId` is the property of the same name associated with a
[Brave Vault client endpoint](https://github.com/brave/vault-client#vault-properties),
and `options` is:

        { server   : 'http://ledger-staging.brave.com'
        , verboseP : false
        }

and `state` is either: whatever was previously stored in persistent storage, or `{}`.

The  client endpoint should not be referenced until the callback is invoked.

### Bravery Properties
To retrieve the Bravery properties for the Ledger,
the client calls:

        var properties = this.client.get()

where `properties` is a list of configuration options:

| Property    | Possible Values                      |
|------------:|--------------------------------------|
| `setting`   | "adFree" or "adReplacement"          |
| `fee`       | for "adFree", the monthly fee in BTC |

To update the Bravery properties for the Ledger,
the client calls:

        this.client.set(properties, callback)

Note that this will likely result in the `callback` being invoked with a `result` parameter,
indicating that persistent storage be updated.

### Wallet Properties

        var address = this.client.walletAddress()

        this.client.walletProperties(function (err, properties) {
            console.log('wallet balance=' + properties.balance + 'BTC')
        })

        var redirectURL = this.client.verifyURL()

### Monthly Reconcilation
The client should periodical call:

        var nowP = client.readyToReconcile()

If `true` is returned,
then it is time for the monthly reconcilation to occur.

If the Bravery `setting` is `adFree`,
then the client prepares the browsing report and calls:

        client.reconcile(report, callback)

For the `report` parameter, the associated [JSON schema](http://json-schema.org/latest/json-schema-core.html) is:

        { "id": "http://brave.com/report-schema#"
        , "$schema": "http://json-schema.org/draft-04/schema#"
        , "type": "object"
        , "properties":
          { "report":
            { "type": "array"
            , "minItems": 1
            , "items":
              { "type": "object"
              , "properties":
                { "site": { "type": "string", "format": "uri" }
                , "weight": { "type": "number" }
                }
              , "required": [ "site", "weight" ]
              }
            }
          }
        , "required": [ "report" ]
        }


Otherwise, if the Bravery `setting` is `adReplacement`, then the client calls:

        client.reconcile(callback)

Regardless of the value of the Bravery `setting`,


## Examples
The file `blastoff.js` is a (non-sensical) example of how to use the API --
it blasts through the various API calls,
doing a sanity check.
