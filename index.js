const { initKaspaFramework } = require('@kaspa/wallet');
const { PrivateKey, Transaction, crypto } = require('@kaspa/core-lib');
const axios = require('axios');

async function run() {
    await initKaspaFramework();
    // From BIP 0340
    const sk = new PrivateKey('B7E151628AED2A6ABF7158809CF4F3C762E7160F38B4DA56A784D9045190CFEF');
    const pk = sk.toPublicKey();

    const kaspaAddress = pk.toAddress('kaspa').toCashAddress();

    console.info(kaspaAddress);

    const { data: utxos } = await axios.get(`https://api.kaspa.org/addresses/${kaspaAddress}/utxos`);
    console.info(utxos);

    if (utxos.length === 0) {
        console.info('Send some kaspa to', kaspaAddress, 'before proceeding with the demo');
        return;
    }

    const tx = new Transaction();

    tx.from(new Transaction.UnspentOutput({
        address: kaspaAddress,
        txId: utxos[0].outpoint.transactionId,
        outputIndex: utxos[0].outpoint.index,
        script: utxos[0].utxoEntry.scriptPublicKey.scriptPublicKey,
        satoshis: Number(utxos[0].utxoEntry.amount),
    }));

    const txOutput = new Transaction.Output({
        script: utxos[0].utxoEntry.scriptPublicKey.scriptPublicKey,
        satoshis: Number(utxos[0].utxoEntry.amount) - 2000, // Assume 0.00002 KAS is the tx fee
    });

    tx.addOutput(txOutput);

    console.info(tx.inputs[0]);

    // Manually call the signing for the one input. You need to call this for each input:
    const inputSignature = tx.inputs[0].getSignatures(tx, sk, 0, crypto.Signature.SIGHASH_ALL, null, 'schnorr')[0];
    console.info(inputSignature.signature.toString());

    const signature = inputSignature.signature.toString();

    // Confirm that what we have in our input is what we retrieved:
    console.info(tx.inputs[0].prevTxId.toString('hex') === utxos[0].outpoint.transactionId);
    console.info(txOutput.script.toBuffer().toString('hex') === utxos[0].utxoEntry.scriptPublicKey.scriptPublicKey)

    const restApiJson = {
        "transaction": {
          "version": 0,
          "inputs": [
            {
              "previousOutpoint": {
                "transactionId": utxos[0].outpoint.transactionId,
                "index": tx.inputs[0].outputIndex,
              },
              "signatureScript": `41${signature}01`,
              "sequence": tx.inputs[0].sequenceNumber,
              "sigOpCount": 1
            }
          ],
          "outputs": [
            {
              "amount": txOutput.satoshis,
              "scriptPublicKey": {
                "version": 0,
                "scriptPublicKey": txOutput.script.toBuffer().toString('hex'),
              }
            }
          ],
          "lockTime": 0,
          "subnetworkId": "0000000000000000000000000000000000000000"
        },
        "allowOrphan": true
    }

    console.info(restApiJson);

    try {
        const r = await axios.post(`https://api.kaspa.org/transactions`, restApiJson);

        console.info(r);
    } catch (e) {
        console.error(e.response.data);
    }
}

run();