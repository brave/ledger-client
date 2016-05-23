# Ledger Alpha

The goal is to be able to alpha test the ledger client and server code,
without requiring any UI work.
(It maybe desirable to provide an "About Ledger" tab, but it's not necessary.)

## Activation
On startup,
the browser will look for a JSON file in the user's "Application Support/Brave" area --
if present, the browser will activate the ledger client code.
__(The name of the file is unimportant.)__

Note that because the JSON file contains sensitive information,
it should be protected on the user's computer.
__(Perhaps the browser when the browser checks for the file on startup,
if it finds it, it stores it in secure, persistant storage and then deletes the file?)__

## Initialization
The browser will retrieve the `client` object from the JSON file and use `client.personaId` and `client.options` values
as the first two parameters when creating the client endpoint.

In particular,
the `client.options` value will contain information to allow the client to provide configuration information.
The Bitcoin wallet, etc., will be pre-funded and authorized by Brave Software (e.g., for $25),
since the reconcilation period will likely be 3 days.

    { client         :
      { persona      : '...'
      , options      :
        { server     : 'https://ledger-staging.brave.com'
        , loggingP   : true
        , wallet     :
          { address  : '...'
          , provider : 'coinbase'
          , currency : 'USD'
          }
        }
      }
    }

## Operations
After the client is created,
the usual calls to the client's `sync()` method should be made.
This will often result in the `callback` parameter being invoked to store state information in secure, persistant storage --
which will be use when re-creating the client endpoint whenever the browser restarts.

In addition,
whenever the `callback` function is invoked with a non-null `result` parameter,
the function should invoke the client's `report()` method and save the resulting JSON object to a file.
The alpha tester will be asked to submit this file to the ledger developer on a periodic basis.

Finally,
if the `callback` function is invoked with a non-null `result` parameter having a `result.thisPayment` field,
then the user should be directed to the URL `result.thisPayment.paymentURL` --
__note that this URL has a short lifetime associated with it,
so when it is returned, the browser needs to encourage the user accordingly!__
