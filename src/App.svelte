<script>
    import Card from '@smui/card/bare';
    import '@smui/card/bare.css';
    import Tab, { Label } from '@smui/tab/bare';
    import '@smui/tab/bare.css';
    import TabBar from '@smui/tab-bar/bare';
    import '@smui/tab-bar/bare.css';
    import CountDown from './components/CountDown.svelte';
    import Settings from './components/Settings.svelte';

    let active = 'Clock';
</script>

<style>
    main {
        width: 100vw;
        height: 100vh;
        display: flex;
        justify-content: center;
        align-items: center;
    }
    .container {
        min-width: 400px;
        max-width: 100%;
    }
</style>

<main>
    <div class="container">
        <Card>
            <TabBar tabs={['Clock', 'Setting']} let:tab bind:active>
                <Tab {tab}>
                    <Label>{tab}</Label>
                </Tab>
            </TabBar>
            {#if active == 'Clock'}
                <CountDown />
            {:else}
                <Settings />
            {/if}
        </Card>
    </div>
</main>
