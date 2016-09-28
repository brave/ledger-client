const underscore = require('underscore')

/**
 * Filter an array of transactions by an array of viewingIds
 * @example
 * txUtil.getTransactionsByViewingIds(state.transactions, '0ef3a02d-ffdd-41f1-a074-7a7eb1e8c332')
 * // [ { viewingId: '0ef3a02d-ffdd-41f1-a074-7a7eb1e8c332',
 * //     surveyorId: 'DQfCj8PHdIEJOZp9/L+FZcozgvYoIVSjPSdwqRYQDr0',
 * //     contribution: { fiat: [Object], rates: [Object], satoshis: 813916, fee: 8858 },
 * //    ...
 * //    }]
 *
 * @param {Object[]} transactions - array of one or more ledger transactions objects (see `client.state.transactions` entries)
 * @param {string[]=} viewingIds - OPTIONAL array of one or more viewingIds to filter transactions (single string viewingId supported too)
 *                            if null or undefined, all transactions are returned
 */
let getTransactionsByViewingIds = function getTransactionsByViewingIds (transactions, viewingIds) {
  if (!transactions) {
    return []
  }
  if (!underscore.isArray(transactions)) {
    if(!underscore.isObject(transactions)) {
      return []
    }
    transactions = [transactions]
  }

  if (!viewingIds) {
      return transactions
  }

  if (viewingIds && typeof (viewingIds) === 'string') {
    viewingIds = [viewingIds]
  }
  if (viewingIds && !viewingIds.length) {
    viewingIds = null
  }

  if (!viewingIds) {
    return []
  }

  transactions = transactions.filter(function (tx) {
    return tx && tx.viewingId && (viewingIds.indexOf(tx.viewingId) > -1)
  })

  return transactions
}

/**
 * Gives a contribution summary for an array of one or more transactions
 * @example
 * txUtil.getTotalContribution(client.state.transactions)
 * // { satoshis: 1627832, fiat: { amount: 10, currency: 'USD' }, fee: 19900 }
 *
 * @param {Object[]} transactions - array of one or more ledger transactions objects (see `client.state.transactions` entries)
 * @param {string[]} viewingIds - OPTIONAL array/string containing one or more viewingIds to filter by
 *                            if null or undefined, all transactions are used
 */
let getTotalContribution = function getTotalContribution (transactions, viewingIds) {
  var txs = getTransactionsByViewingIds(transactions, viewingIds)

  var totalContribution = {
    satoshis: 0,
    fiat: { amount: 0, currency: null },
    fee: 0
  }

  for (var i = txs.length - 1; i >= 0; i--) {
    var tx = txs[i] || {}
    var txContribution = tx.contribution || {}

    totalContribution.satoshis += 0 || txContribution.satoshis

    if (txContribution.fiat) {
      if (!totalContribution.fiat.currency && txContribution.fiat.currency) {
        totalContribution.fiat.currency = txContribution.fiat.currency
      }

      if (totalContribution.fiat.currency === txContribution.fiat.currency) {
        totalContribution.fiat.amount += 0 || (txContribution.fiat && txContribution.fiat.amount)
      } else {
        throw new Error('ledgerUtil.totalContribution cannot handle multiple fiat currencies')
      }
    }

    totalContribution.fee += 0 || txContribution.fee
  }

  return totalContribution
}

/**
 * Gives a summary of votes/contributions by Publisher from an array of one or ore transactions
 * @example
 * txUtil.getPublisherVoteData(client.state.transactions)
 * // { 
 * //  'chronicle.com':
 * //     { votes: 2,
 * //       fraction: 0.04081632653061224,
 * //       contribution: { satoshis: 33221, fiat: 0.2040816326530612, currency: 'USD' } },
 * //  'waitbutwhy.com':
 * //     { votes: 3,
 * //       fraction: 0.061224489795918366,
 * //       contribution: { satoshis: 49832, fiat: 0.30612244897959184, currency: 'USD' } },
 * //  'archlinux.org':
 * //     { votes: 1,
 * //       fraction: 0.02040816326530612,
 * //       contribution: { satoshis: 16611, fiat: 0.1020408163265306, currency: 'USD' } },
 * //    /.../
 * // }
 *
 * @param {Object[]} transactions - array of transactions
 * @param {string[]=} viewingIds - OPTIONAL array/string with one or more viewingIds to filter transactions by (if empty, uses all tx)
 **/
let getPublisherVoteData = function getPublisherVoteData(transactions, viewingIds) {
  var transactions = getTransactionsByViewingIds(transactions, viewingIds)

  var publishersWithVotes = {}
  var totalVotes = 0

  for (var i = transactions.length - 1; i >= 0; i--) {
    var tx = transactions[i]
    var ballots = tx.ballots

    if (!ballots) {
      continue
    }

    var publishersOnBallot = underscore.keys(ballots)

    for (var j = publishersOnBallot.length -1; j >= 0; j--) {
      var publisher = publishersOnBallot[j]

      var voteDataForPublisher = publishersWithVotes[publisher] || {}

      var voteCount = ballots[publisher]
      var publisherVotes = (voteDataForPublisher.votes || 0) + voteCount
      totalVotes += voteCount

      voteDataForPublisher.votes = publisherVotes
      publishersWithVotes[publisher] = voteDataForPublisher
    }

  }

  var totalContributionAmountSatoshis = null
  var totalContributionAmountFiat = null
  var currency = null

  var totalContribution = getTotalContribution(transactions)

  if (totalContribution) {
    totalContributionAmountSatoshis = totalContributionAmountSatoshis || totalContribution.satoshis
    totalContributionAmountFiat = totalContributionAmountFiat || (totalContribution.fiat && totalContribution.fiat.amount)
    currency = currency || (totalContribution.fiat && totalContribution.fiat.currency)
  }

  for (var publisher in publishersWithVotes) {
    var voteDataForPublisher = publishersWithVotes[publisher]
    var fraction = voteDataForPublisher.fraction = voteDataForPublisher.votes / totalVotes

    var contribution = voteDataForPublisher.contribution || {}
    if (totalContributionAmountSatoshis) {
      contribution.satoshis = Math.round(totalContributionAmountSatoshis * fraction)
    }
    if (totalContributionAmountFiat) {
      contribution.fiat = totalContributionAmountFiat * fraction
    }
    if (currency) {
      contribution.currency = currency
    }

    voteDataForPublisher.contribution = contribution

    publishersWithVotes[publisher] = voteDataForPublisher
  }

  return publishersWithVotes
}


/**
 * Generates a contribution breakdown by publisher in an array of CSV rows from an array of transactions
 * @example
 * txUtil.getTransactionCSVRows(client.state.transactions)
 * // [ 'Publisher,Votes,Fraction,BTC,USD',
 * //   'chronicle.com,2,0.04081632653061224,0.0000033221,0.20 USD',
 * //   'waitbutwhy.com,3,0.061224489795918366,0.0000049832,0.31 USD',
 * //   'archlinux.org,1,0.02040816326530612,0.0000016611,0.10 USD',
 * //   /.../
 * // ]
 *
 * @param {Object[]} transactions - array of transactions
 * @param {string[]=} viewingIds - OPTIONAL array/string with one or more viewingIds to filter transactions by (if empty, uses all tx)
 **/
let getTransactionCSVRows = function (transactions, viewingIds) {
  let txContribData = getPublisherVoteData(transactions, viewingIds)
  var publishers = underscore.keys(txContribData)

  var currency = txContribData[publishers[0]].contribution.currency
  var headerRow = ['Publisher','Votes','Fraction','BTC', currency].join(',')

  var rows = [headerRow]

  rows = rows.concat(publishers.map(function (pub) { 
    var pubRow = txContribData[pub]
    return [pub,
            pubRow.votes,
            pubRow.fraction,
            pubRow.contribution.satoshis / Math.pow(10, 10), 
            pubRow.contribution.fiat.toFixed(2) + ' ' + pubRow.contribution.currency
           ].join(',') 
  }))

  return rows
}


/**
 * Generates a contribution breakdown by publisher in an array of CSV rows from an array of transactions
 * @example
 * txUtil.getTransactionCSVText(state.transactions)
 * // 'Publisher,Votes,Fraction,BTC,USD\nchronicle.com,2,0.04081632653061224,0.0000033221,0.20 USD\nwaitbutwhy.com,3,0.061224489795918366,0.0000049832,0.31 USD\narchlinux.org,1,0.02040816326530612,0.0000016611,0.10 USD /.../'
 *
 * @param {Object[]} transactions - array of transactions
 * @param {string[]=} viewingIds - OPTIONAL array/string with one or more viewingIds to filter transactions by (if empty, uses all tx)
 **/
let getTransactionCSVText = function (transactions, viewingIds) {
  return getTransactionCSVRows(transactions).join('\n')
}

module.exports = {
  getTransactionCSVText: getTransactionCSVText,
  getTransactionCSVRows: getTransactionCSVRows,
  getPublisherVoteData: getPublisherVoteData,
  getTransactionsByViewingIds: getTransactionsByViewingIds,
  getTotalContribution: getTotalContribution
}
