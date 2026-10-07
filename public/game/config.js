export const CONFIG = {
    DEBUG: false,

    SCORES: {
        fruit: 100,
        star: 300,
        bomb: -250
    },

    DIFFICULTY: {
        easy: {
            interval: 1100,
            speed: 0.72,
            max: 4,
            bomb: 0.09
        },
        medium: {
            interval: 760,
            speed: 1,
            max: 6,
            bomb: 0.16
        },
        hard: {
            interval: 520,
            speed: 1.32,
            max: 8,
            bomb: 0.24
        }
    },

    FRUITS: [
        { name: 'apple', asset: '/assets/fruits/apple.svg', color: '#e84b4b' },
        { name: 'banana', asset: '/assets/fruits/banana.svg', color: '#ffe56d' },
        { name: 'orange', asset: '/assets/fruits/orange.svg', color: '#ffae34' },
        { name: 'strawberry', asset: '/assets/fruits/strawberry.svg', color: '#e84b4b' },
        { name: 'watermelon', asset: '/assets/fruits/watermelon.svg', color: '#61c96b' }
    ]
};