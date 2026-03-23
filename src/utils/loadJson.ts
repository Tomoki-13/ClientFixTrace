import fs from 'fs';
import { Item } from "../types/Item";
import { Client_Ver } from "../types/VersionCommits";
import { VersionPair } from '../types/VersionPair';

const item = (filePath: string): Item[] => {
  const jsonData = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(jsonData) as Item[];
};

const clientVer = (filePath: string): Client_Ver[] => {
  const jsonData = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(jsonData) as Client_Ver[];
};

const versionPair = (filePath: string): VersionPair[] => {
  const jsonData = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(jsonData) as VersionPair[];
};

export default {
  item,
  clientVer,
  versionPair
};