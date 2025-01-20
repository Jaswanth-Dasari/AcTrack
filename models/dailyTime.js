const mongoose = require('mongoose');

const dailyTimeSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true
    },
    date: {
        type: Date,
        required: true
    },
    totalSeconds: {
        type: Number,
        default: 0
    },
    tasks: [{
        taskId: String,
        seconds: Number,
        title: String,
        projectName: String
    }]
}, { timestamps: true });

module.exports = mongoose.model('DailyTime', dailyTimeSchema); 