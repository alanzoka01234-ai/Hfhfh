
import { SavedData } from '../types';

const STORAGE_KEY = 'cyber_survivor_v1';

const DEFAULT_DATA: SavedData = {
  totalCoins: 0,
  selectedSkin: 'default',
  unlockedSkins: ['default'],
  sfxEnabled: true,
  permanentUpgrades: {
    health: 0,
    damage: 0,
    speed: 0,
  },
};

export const PersistenceService = {
  save: (data: SavedData) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  },
  load: (): SavedData => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? { ...DEFAULT_DATA, ...JSON.parse(saved) } : DEFAULT_DATA;
  },
  addCoins: (amount: number) => {
    const data = PersistenceService.load();
    data.totalCoins += amount;
    PersistenceService.save(data);
  },
  spendCoins: (amount: number): boolean => {
    const data = PersistenceService.load();
    if (data.totalCoins >= amount) {
      data.totalCoins -= amount;
      PersistenceService.save(data);
      return true;
    }
    return false;
  },
  toggleSfx: (): boolean => {
    const data = PersistenceService.load();
    data.sfxEnabled = !data.sfxEnabled;
    PersistenceService.save(data);
    return data.sfxEnabled;
  },
  unlockSkin: (skinId: string) => {
    const data = PersistenceService.load();
    if (!data.unlockedSkins.includes(skinId)) {
      data.unlockedSkins.push(skinId);
      PersistenceService.save(data);
    }
  },
  setSelectedSkin: (skinId: string) => {
    const data = PersistenceService.load();
    data.selectedSkin = skinId;
    PersistenceService.save(data);
  },
  buyPermanentUpgrade: (key: 'health' | 'damage' | 'speed', cost: number) => {
    const data = PersistenceService.load();
    if (data.totalCoins >= cost) {
      data.totalCoins -= cost;
      data.permanentUpgrades[key]++;
      PersistenceService.save(data);
      return true;
    }
    return false;
  }
};
