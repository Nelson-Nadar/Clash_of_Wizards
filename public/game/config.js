export const CONFIG = {
    DEBUG: false,

    SCORES: {
        fruit: 100,
        star: 300,
        bomb: -250
    },

    DIFFICULTY: {
        easy: { interval: 1100, speed: 0.72, max: 4, bomb: 0.09 },
        medium: { interval: 760, speed: 1, max: 6, bomb: 0.16 },
        hard: { interval: 520, speed: 1.32, max: 8, bomb: 0.24 }
    },

    ENTITIES: [
        { name: 'dementor', asset: '/assets/entities/dementors.svg', color: '#6f7b98', weight: 50 },
        { name: 'bellatrix', asset: '/assets/entities/bellatrix.svg', color: '#b58bcb', weight: 5 },
        { name: 'death_eater', asset: '/assets/entities/death_eater.svg', color: '#8c8c9b', weight: 11.25 },
        { name: 'dragon', asset: '/assets/entities/dragon.svg', color: '#c94c42', weight: 11.25 },
        { name: 'troll', asset: '/assets/entities/troll.svg', color: '#7c9a70', weight: 11.25 },
        { name: 'werewolf', asset: '/assets/entities/werewolf.svg', color: '#a49b8d', weight: 11.25 }
    ],

    SPECIAL_ENTITY: { name: 'golden_snitch', asset: '/assets/entities/golden_snitch.svg', color: '#ffe568' },
    PENALTY_ENTITY: { name: 'dobby', asset: '/assets/entities/dobby.svg', color: '#b5d5bd' }
};
