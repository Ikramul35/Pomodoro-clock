<script>
    import Button, { Icon, Label } from '@smui/button/bare';
    import '@smui/button/bare.css';
    import { workDur, breakDur, longBreakDur, noOfSession } from '../stores';
    import { onDestroy } from 'svelte';

    let min = $workDur;
    let sec = 0;
    let ctr = null;
    let takingBreak = true;
    let currentSession = $noOfSession;

    $: countDown = `${min < 10 ? '0' : ''}${min}:${sec < 10 ? '0' : ''}${sec}`;

    let decCtr = () => {
        if (min == 0 && sec == 0) {
            nextCtr();
        } else if (sec == 0) {
            min--;
            sec = 59;
        } else {
            sec--;
        }
    };

    let ctrStart = () => {
        if (ctr != null) return;
        ctr = setInterval(decCtr, 1000);
    };

    let ctrPause = () => {
        clearInterval(ctr);
        ctr = null;
    };

    let ctrReset = () => {
        ctrPause();
        min = $workDur;
        sec = 0;
    };

    let nextCtr = () => {
        takingBreak = !takingBreak;
        if (currentSession == 0) {
            min = $longBreakDur;
            currentSession = $noOfSession;
            alert('Long Break Starting');
        } else if (takingBreak) {
            min = $breakDur;
            alert('Break Starting');
        } else {
            currentSession--;
            min = $workDur;
            alert('Session Starting');
        }
        console.log(takingBreak);
        ctrStart();
    };

    onDestroy(ctrPause);
</script>

<style>
    p {
        font-size: 5rem;
        text-align: center;
        margin: 10px 0;
    }
    .btn-container {
        display: flex;
        justify-content: space-evenly;
        margin-bottom: 10px;
        font-weight: bold;
    }
</style>

<p>{countDown}</p>
<div class="btn-container">
    <Button on:click={ctrPause}>
        <Icon class="material-icons">pause_circle_outline</Icon>
        <Label>Pause</Label>
    </Button>
    <Button on:click={nextCtr}>
        <Icon class="material-icons">play_circle_outline</Icon>
        <Label>Start</Label>
    </Button>
    <Button on:click={ctrReset}>
        <Icon class="material-icons">replay</Icon>
        <Label>Reset</Label>
    </Button>
</div>
