import { Item } from "./types/Item";
import { extractVersion } from "./core/extractVersion";
import { loadJsonData_Item } from "./utils/loadJson";

(async () => {
    // const data:Item[] = await loadJsonData('../datasets/test_result.json');
    const data:Item[] = await loadJsonData_Item('../datasets/sample.json');
    const libName = 'uuid';
    // ライブラリを使用しているクライアントのリストを取得
    let client_list = data.filter(item => item.L__nameWithOwner.includes(libName)).map(item => item.S__nameWithOwner);
    client_list = [...new Set(client_list)];
    extractVersion(client_list,libName);
})();