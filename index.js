const { initKaspaFramework } = require('@kaspa/wallet');
const { PrivateKey, PublicKey, Address, Transaction, crypto, Script } = require('@kaspa/core-lib');
const axios = require('axios');

async function run() {
    await initKaspaFramework();

    const randomSecretKey = new PrivateKey();
    console.info('randomSecretKey\t\t\t\t\t\t\t', randomSecretKey.toString());
    console.info('randomSecretKey.toAddress("kaspa")\t\t\t\t', randomSecretKey.toAddress('kaspa').toString());
    console.info('randomSecretKey.toPublicKey().toString()\t\t\t', randomSecretKey.toPublicKey().toString());
    console.info('randomSecretKey.toPublicKey().toAddress("kaspa").toString()\t', randomSecretKey.toPublicKey().toAddress('kaspa').toString());

    // From BIP 0340
    const sk = new PrivateKey('B7E151628AED2A6ABF7158809CF4F3C762E7160F38B4DA56A784D9045190CFEF');
    const pk = sk.toPublicKey();

    // Returns the x-coord hex representation of the public key
    console.info(pk.toString());
    console.info(pk.toObject());

    // If you only have the X-coord, prepend it with either '02' if Y-coord is even, '03' if Y-coord is odd
    // This section is intended to demonstrate creating public keys:
    const xCoordHex = pk.toObject().x;
    const yCoordHex = pk.toObject().y;
    const fullDERRepresentation = '04' + xCoordHex + yCoordHex;
    console.info(pk.toString() === xCoordHex);
    console.info(new PublicKey('02' + xCoordHex).toObject()); // Y valye is correct
    console.info(new PublicKey('03' + xCoordHex).toObject()); // Y value is incorrect
    console.info(new PublicKey(fullDERRepresentation).toString());
    console.info(PublicKey.fromX(false, xCoordHex).toString());
    console.info(PublicKey.fromX(true, xCoordHex).toString());

    const kaspaAddress = pk.toAddress('kaspa').toCashAddress(); // Should be kaspa:qr0lr4ml9fn3chekrqmjdkergxl93l4wrk3dankcgvjq776s9wn9jkdskewva

    console.info(kaspaAddress);

    console.info('--- Script Public Key examples');
    console.info('Script Public Key from Address (via pk)\t\t\t', new Script(pk.toAddress('kaspa')).toBuffer().toString('hex'));
    console.info('Script Public Key from Address (via string)\t\t', new Script(new Address(kaspaAddress)).toBuffer().toString('hex'));
    console.info('Script Public Key from ECDSA Address (via string)\t', new Script(new Address('kaspa:qypdtlw845g6vhgtheug9lpahjgmtpsarqkueeul0sd7t07npfnhe4s7fd82n0v')).toBuffer().toString('hex'));
    console.info('Script Public Key of devfund (example p2sh address)\t', new Script(new Address('kaspa:precqv0krj3r6uyyfa36ga7s0u9jct0v4wg8ctsfde2gkrsgwgw8jgxfzfc98')).toBuffer().toString('hex'));

    console.info('--- Getting UTXOs from API');
    const { data: utxos } = await axios.get(`https://api.kaspa.org/addresses/${kaspaAddress}/utxos`);
    console.info(utxos);

    let selectedUtxo = null;

    for (const utxo of utxos) {
        // We need to work with at least 0.001 KAS
        if (utxo.utxoEntry.amount >= 100000) {
            //
            selectedUtxo = utxo;
            break;
        }
    }
    
    if (!selectedUtxo) {
        console.info('Send at least 0.001 kaspa to', kaspaAddress, 'before proceeding with the demo');
        return;
    }

    const tx = new Transaction();
    tx.setVersion(0); // Very important!

    const txInput = new Transaction.Input.PublicKey({
      prevTxId: selectedUtxo.outpoint.transactionId,
      outputIndex: selectedUtxo.outpoint.index,
      script: selectedUtxo.utxoEntry.scriptPublicKey.scriptPublicKey,
      sequenceNumber: 0,
      output: new Transaction.Output({
        script: selectedUtxo.utxoEntry.scriptPublicKey.scriptPublicKey,
        satoshis: Number(selectedUtxo.utxoEntry.amount),
      })
    });

    const fee = 3000; // Assume 0.00003 KAS is the tx fee
    const amountToSend = Math.round(Number(selectedUtxo.utxoEntry.amount) / 2);
    const amountAsChange = Number(selectedUtxo.utxoEntry.amount) - amountToSend - fee;

    const txOutput = new Transaction.Output({
        script: new Script(new Address(kaspaAddress)).toBuffer().toString('hex'),
        satoshis: amountToSend,
    });

    const txChange = new Transaction.Output({
        script: new Script(new Address(kaspaAddress)).toBuffer().toString('hex'),
        satoshis: amountAsChange,
    });

    // Add my inputs and outputs
    tx.addInput(txInput);
    tx.addOutput(txOutput);
    // This change is so you change the excess amount to yourself
    tx.addOutput(txChange);

    // Manually call the signing for the one input. You need to call this for each input:
    console.info('---- Applying signatures');
    const signedInputs = tx.inputs.map((input, index) => {
      const inputSignature = input.getSignatures(tx, sk, 0, crypto.Signature.SIGHASH_ALL, null, 'schnorr')[0];

      console.info(`Signature for TxInput #${index}`, inputSignature.signature.toBuffer('schnorr').toString('hex'));
      const signature = inputSignature.signature.toBuffer('schnorr').toString('hex');

      return {
        "previousOutpoint": {
          "transactionId": input.prevTxId.toString('hex'),
          "index": input.outputIndex,
        },
        "signatureScript": `41${signature}01`,
        "sequence": input.sequenceNumber,
        "sigOpCount": 1
      };
    });

    // Construct the REST API JSON
    const restApiJson = {
        "transaction": {
          "version": tx.version,
          "inputs": signedInputs,
          "outputs": [
            {
              "amount": amountToSend,
              "scriptPublicKey": {
                "version": 0,
                "scriptPublicKey": txOutput.script.toBuffer().toString('hex'),
              }
            },
            {
                "amount": amountAsChange,
                "scriptPublicKey": {
                  "version": 0,
                  "scriptPublicKey": txChange.script.toBuffer().toString('hex'),
                }
            }
          ],
          "lockTime": 0,
          "subnetworkId": "0000000000000000000000000000000000000000"
        },
        "allowOrphan": true
    }

    console.info('---- JSON to be sent to POST https://api.kaspa.org/transactions');
    console.info(JSON.stringify(restApiJson, null, 4));

    try {
        console.info('---- Transaction Success');
        const {data: successTxResponse} = await axios.post(`https://api.kaspa.org/transactions`, restApiJson);

        console.info(successTxResponse);
    } catch (e) {
        console.info('---- Transaction Failed');
        console.error(e.response.data);
    }
}

run();