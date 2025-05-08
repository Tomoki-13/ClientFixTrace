import { loadJsonData_Client_Ver } from "./utils/loadJson";
import { Client_Ver } from "./types/VersionCommits";
import { VersionPair } from "./types/VersionPair";
import { create_version_pairs } from "./core/create_version_pairs";

(async () => {
    const libName = 'uuid';
    const data:Client_Ver[] = await loadJsonData_Client_Ver('');
    //inputList：[[クライアントごと],[...]]全体のバージョン履歴 クライアントのないでの重複も含む
    let inputList:string[][] = [];
    data.forEach((element) => {
        let tmp_strArray:string[] = [];
        //console.log('element:',element.verList);
        if(element.verList.length > 1){
            element.verList.forEach((ver) => {
                tmp_strArray.push(ver.version);
            });
        }
        inputList.push(tmp_strArray);
    });
    // console.log('inputList:',inputList);
    //console.log('inputList:',inputList);
    let pairs:VersionPair[] = create_version_pairs(inputList,libName,1);
    console.log(pairs);
})();