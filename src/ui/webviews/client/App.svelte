<script lang="ts">
  import { onMount } from 'svelte';
  import { sendReady, onHostMessage } from './bridge';
  import { handleHostToWebviewMessage } from './hostMessageDispatch';
  import Layout from './components/spa/Layout.svelte';

  onMount(() => {
    performance.mark('jsm:mount');
    onHostMessage(handleHostToWebviewMessage);
    sendReady();

    document.body.classList.add('spa-mode');
  });
</script>

<Layout />
