import { DATA_TYPE_DEFINEDKEY, DefinedKey } from "verus-typescript-primitives";

const main = () => {
  const params = process.argv;

  if (!params[2]) throw new Error("No VDXF key provided");

  const key = new DefinedKey({
    vdxfuri: params[2]
  })

  const updateIdentityJson = {
    name: params[3] ? params[3] : "",
    contentmultimap: {
      [DATA_TYPE_DEFINEDKEY.vdxfid]: [key.toBuffer().toString('hex')]
    }
  }

  console.log(key.getIAddr())
  console.log(JSON.stringify(updateIdentityJson))
}

main()