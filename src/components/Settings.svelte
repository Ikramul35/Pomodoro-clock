<script>
    import Slider from '@smui/slider/bare';
    import '@smui/slider/bare.css';
    import { workDur, breakDur, longBreakDur, noOfSession } from '../stores';
</script>

<style>
    form {
        padding: 20px;
    }
    .form-container {
        width: 100%;
        padding: 0 10px;
        display: flex;
        align-items: center;
    }

    .form-container span:last-child {
        display: inline-block;
        margin-left: 10px;
    }
</style>

<form>
    <p>Work Time</p>
    <div class="form-container">
        <Slider bind:value={$workDur} min={1} max={60} discrete />
        <span>{$workDur}</span>
    </div>
    <p>Break Time</p>
    <div class="form-container">
        <Slider bind:value={$breakDur} min={1} max={60} discrete />
        <span>{$breakDur}</span>
    </div>
    <p>Long Break Time</p>
    <div class="form-container">
        <Slider bind:value={$longBreakDur} min={1} max={60} discrete />
        <span>{$longBreakDur}</span>
    </div>
    <p>Session</p>
    <div class="form-container">
        <Slider bind:value={$noOfSession} min={1} max={10} discrete />
        <span>{$noOfSession}</span>
    </div>
</form>
