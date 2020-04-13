const EventEmitter = require('events');

class SegmentQueue extends EventEmitter
{
    constructor() {
        super();

        this.segments = [];
        this.trackNames = [];
        this.segment = -1;

        this.on('segment', segment => {
            if (this.trackNames[0] != segment.title) {
                this.trackNames.unshift(segment.title);
                this.emit('titles', this.trackNames);
            }
        });
    }

    setStartingSegment(id) {
        this.segment = id;
    }

    isReady() {
        return (this.segment != -1);
    }

    add(segment) {
        this.segments.push(segment);
        this.segments.sort((a, b) => {
            if (a.mediaSequenceNumber < b.mediaSequenceNumber) return -1;
            if (a.mediaSequenceNumber > b.mediaSequenceNumber) return 1;
            
            return 0;
        });

        this.checkForSegments();
    }

    checkForSegments() {
        if (! this.segments[0] || (this.segments[0].mediaSequenceNumber != this.segment)) return;

        let segment = this.segments.shift();
        this.segment++;
        this.emit('segment', segment);
        this.checkForSegments();
    }
}

exports.SegmentQueue = SegmentQueue;