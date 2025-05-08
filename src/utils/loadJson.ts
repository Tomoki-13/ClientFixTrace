import fs from 'fs';
import { Item } from "../types/Item";
import { Client_Ver } from "../types/VersionCommits";
import { VersionPair } from '../types/VersionPair';
export const loadJsonData_Item = (filePath: string): Item[] => {
    const jsonData = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(jsonData) as Item[];
};
export const loadJsonData_Client_Ver = (filePath: string): Client_Ver[] => {
    const jsonData = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(jsonData) as Client_Ver[];
};
export const loadJsonData_VersionPair = (filePath: string): VersionPair[] => {
    const jsonData = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(jsonData) as VersionPair[];
};