import { loadJsonData_Client_Ver } from "./utils/loadJson";
import { Client_Ver } from "./types/VersionCommits";
import { VersionPair } from "./types/VersionPair";
import { create_version_pairs } from "./core/create_version_pairs";

(async () => {
    const libName = 'uuid';
    const data:Client_Ver[] = await loadJsonData_Client_Ver('../datasets/output/uuid_version_history_2025-04-15-01-02-30.json');
    //inputList：[[クライアントごと],[...]]全体のバージョン履歴
    let inputList:string[][] = [];
    data.forEach((element) => {
        let tmp_strArray:string[] = [];
        element.verList.forEach((ver) => {
            tmp_strArray.push(ver.version);
        });
        inputList.push(tmp_strArray);
    });
    console.log('inputList:',inputList);
    let pairs:VersionPair[] = create_version_pairs(inputList,libName);
    console.log(pairs);
})();