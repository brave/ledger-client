# NOTE: This repo is deprecated, please see [bat-client](https://github.com/brave-intl/bat-client)
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

        var Client = require('ledger-client')
        this.client = new Client(personaId, options, state)
        this.client.sync(callback)

where the value for `personaId` (if not `null`) is a
[UUID v4](https://en.wikipedia.org/wiki/Universally_unique_identifier#Version_4_.28random.29) value and `options` is:

        // all properties are optional...
        { server            : 'https://ledger.brave.com'
        , debugP            : false
        , loggingP          : false
        , verboseP          : false
        }

and `state` is either: whatever was previously stored in persistent storage, or `{}`.

The client endpoint should not be referenced until the callback is invoked.

### Bravery Properties
To retrieve the Bravery properties for the Ledger,
the client calls:

        var properties = this.client.getBraveryProperties()

where `properties` is a list of configuration options:

| Property    | Meaning                     | Examples                     |
|------------:|-----------------------------|------------------------------|
| `setting`   | "adFree" or "adReplacement" | adFree                       |
| `days`      | the reconcilation period    | 30                           |
| `fee`       | for "adFree"                | { currency: USD, amount: 5 } |

To update the Bravery properties for the Ledger,
the client calls:

        this.client.setBraveryProperties(properties, function (err, result) {
          if (err) return console.log(err)

          if (result) result must be put into persistent storage as the client's new state
        })

Note that this will likely result in the `callback` being invoked with a `result` parameter,
indicating that persistent storage be updated.

### Wallet Properties

        var address = this.client.getWalletAddress()

        this.client.getWalletProperties(function (err, properties) {
          if (err) return console.log(err)

          console.log('wallet balance=' + properties.balance + 'BTC')
        })

### Wallet Recovery

        this.client.recoverWallet(recoveryId, passPhrase, function (err, result) {
          if (err) return console.log(err)

          console.log('recovered amount=' + result.satoshis + ' satoshis')
        })

### Reconcilation, Part One
The client should periodically call:

        var nowP = client.isReadyToReconcile()

If `true` is returned,
then it is time for the periodic reconcilation to occur.

Alternatively,

        var msec = client.timeUntilReconcile()

will return `false` if reconcilation is already underway,
or the number of milliseconds before reconcilation should occur
(a negative number indicates that reconcilation is overdue).

It may be necessary to reset the reconcilation timestamp,

        var timestamp = new Date().getTime()  // reconcile now (for some reason)

        this.client.setTimeUntilReconcile(timestamp, function (err, result) {
          if (err) return console.log(err)

          if (result) result must be put into persistent storage as the client's new state
        })

The more likely invocation is

        this.client.setTimeUntilReconcile(null, function (err, result) { ... })

which resets the reconcilation timestamp.

### Reconcilation, Part Deux
When it is time to reconcile,
the client calls:

        client.reconcile(viewingId, callback)

The `viewingId` parameter (if not `null) is a UUID v4 value,
that may be used for subequent calls to `vote()`.

## Statistical Voting
After a successful reconciliation,
the client is authorized to cast one or more ballots,
as indicated by the `ballots` method.
Each vote is cast using the `vote` method:

    if (client.ballots() > 0) {
      // select publisher identity
      client.vote(publisher, viewingId)
    }

The `viewingId` parameter is optional,
otherwise it should correspond to a value used in a previous call to the `reconcile` method.

## Logging
If `options.loggingP` is true,
then the client may call

    var entries = client.report()

which returns either an array of (zero or more) logging entries.
Each entry contains three fields:

        { who  : function that made entry
          what : { parameters }
          when : timestamp (as milliseconds since epoch)
        }

## Examples
The file `blastoff.js` is a (non-sensical) example of how to use the API --
it blasts through the various API calls,
doing a sanity check.
Invoke using:

    % npm run blastoff
    ...
    please click here for payment: bitcoin:...?amount=0.0083
    ^C

    // transfer funds to user wallet, wait as long (or as little) as you want

    % npm run touchdown

When reconciliation completes (but before voting occurs), the process will exit.
Examine `config.json` to see the entry in the `transactions` array.
